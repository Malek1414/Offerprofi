/**
 * Signup validation and tenant bootstrap (F0.6, F0.7).
 *
 * Acceptance: "A stranger can create an account unaided" and "slug collision is
 * handled with a suggestion, not an error page."
 *
 * Split in two on purpose. `validateSignup` is pure and holds every rule about what
 * makes an account request acceptable; `createAccountWithAgency` does the database
 * work and holds none. That means the rules are testable without Postgres, and the
 * SQL has nothing in it a reviewer has to reason about.
 *
 * ─── Why the writes go through SECURITY DEFINER functions ────────────────────
 *
 * Signup is the one moment where there is provably no identity: the person has not
 * authenticated, `app.current_user_id` is unset, and every RLS policy therefore
 * denies (see src/db/client.ts). The rows still have to be written. The alternative
 * to a narrow definer function is connecting as a role that bypasses RLS, which would
 * put a BYPASSRLS credential in the application — and then the whole tenancy story
 * rests on that credential never being used anywhere else.
 *
 * So: `public.bootstrap_agency` writes exactly one user, one agency, one owner
 * membership and one slug reservation, in one transaction, and can do nothing else.
 */

import type { PoolClient } from 'pg'

import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './password'
import { normaliseEmail } from './session'
import { aliasEmailForSlug, checkSlug, slugify, suggestSlugs, type SlugRejection } from './slug'

export interface SignupRequest {
  email: string
  password: string
  /** The person. Appears as "mit {Owner} sprechen" on every customer surface (I5). */
  ownerName: string
  /** The business. Appears on the quote letterhead. */
  agencyName: string
  /** Optional: the owner may override the slug derived from the agency name. */
  slug?: string
}

export type SignupProblem =
  | { field: 'email'; code: 'missing' | 'malformed' | 'too_long' }
  | { field: 'password'; code: 'too_short' | 'too_long' }
  | { field: 'ownerName'; code: 'missing' | 'too_long' }
  | { field: 'agencyName'; code: 'missing' | 'too_long' }
  | { field: 'slug'; code: SlugRejection | 'underivable' }

export interface ValidatedSignup {
  email: string
  password: string
  ownerName: string
  agencyName: string
  slug: string
}

const MAX_NAME_LENGTH = 120
/** RFC 5321 caps a path at 254 characters; anything longer is not a mailbox. */
const MAX_EMAIL_LENGTH = 254

/**
 * A deliberately loose email check.
 *
 * Strict RFC 5322 validation rejects addresses that genuinely deliver, and every
 * false rejection here is a customer who cannot sign up and has no way to argue. The
 * real proof that an address works is the verification mail arriving, so this only
 * catches what is obviously not an address at all.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/

export function validateSignup(input: SignupRequest): {
  ok: true
  value: ValidatedSignup
} | { ok: false; problems: SignupProblem[] } {
  const problems: SignupProblem[] = []

  const email = normaliseEmail(input.email ?? '')
  if (!email) problems.push({ field: 'email', code: 'missing' })
  else if (email.length > MAX_EMAIL_LENGTH) problems.push({ field: 'email', code: 'too_long' })
  else if (!EMAIL_SHAPE.test(email)) problems.push({ field: 'email', code: 'malformed' })

  const password = input.password ?? ''
  if (password.length < MIN_PASSWORD_LENGTH) problems.push({ field: 'password', code: 'too_short' })
  else if (password.length > MAX_PASSWORD_LENGTH) {
    problems.push({ field: 'password', code: 'too_long' })
  }

  const ownerName = (input.ownerName ?? '').trim()
  if (!ownerName) problems.push({ field: 'ownerName', code: 'missing' })
  else if (ownerName.length > MAX_NAME_LENGTH) problems.push({ field: 'ownerName', code: 'too_long' })

  const agencyName = (input.agencyName ?? '').trim()
  if (!agencyName) problems.push({ field: 'agencyName', code: 'missing' })
  else if (agencyName.length > MAX_NAME_LENGTH) {
    problems.push({ field: 'agencyName', code: 'too_long' })
  }

  // An explicit slug is taken as typed. A derived one is the agency name romanised —
  // and if nothing survives, we ask rather than invent (see slugify's contract).
  const slug = input.slug ? slugify(input.slug) : slugify(agencyName)
  if (!slug) problems.push({ field: 'slug', code: 'underivable' })
  else {
    const check = checkSlug(slug)
    if (!check.ok && check.reason) problems.push({ field: 'slug', code: check.reason })
  }

  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, value: { email, password, ownerName, agencyName, slug } }
}

export type SignupOutcome =
  | { status: 'created'; userId: string; agencyId: string; slug: string }
  /**
   * Not an error page. The owner is shown the alternatives and picks one — which is
   * the whole of F0.7's acceptance criterion.
   */
  | { status: 'slug_taken'; suggestions: string[] }
  /**
   * Deliberately vague to the caller's *user*, precise to the caller's code. See the
   * note on enumeration in the route handler.
   */
  | { status: 'email_taken' }

/**
 * Create the user, the agency, the owner membership and the slug reservation.
 *
 * `client` is an unauthenticated connection (`asAnonymous`) — correct here, and only
 * here, because the definer function is the entire write surface.
 */
export async function createAccountWithAgency(
  client: PoolClient,
  signup: ValidatedSignup,
  inboundDomain: string,
): Promise<SignupOutcome> {
  const passwordHash = await hashPassword(signup.password)

  try {
    const result = await client.query<{ user_id: string; agency_id: string }>(
      'select user_id, agency_id from public.bootstrap_agency($1, $2, $3, $4, $5, $6)',
      [
        signup.email,
        passwordHash,
        signup.ownerName,
        signup.agencyName,
        signup.slug,
        aliasEmailForSlug(signup.slug, inboundDomain),
      ],
    )

    const row = result.rows[0]
    if (!row) throw new Error('bootstrap_agency returned no row')
    return { status: 'created', userId: row.user_id, agencyId: row.agency_id, slug: signup.slug }
  } catch (error) {
    const conflict = uniqueViolation(error)
    if (conflict === 'email') return { status: 'email_taken' }
    if (conflict === 'slug') {
      return { status: 'slug_taken', suggestions: await suggestFreeSlugs(client, signup.slug) }
    }
    throw error
  }
}

/**
 * Which unique constraint was violated?
 *
 * Read from the constraint name rather than the message text, which is localised by
 * the server's `lc_messages` and would make this depend on the database's locale.
 */
function uniqueViolation(error: unknown): 'email' | 'slug' | null {
  if (typeof error !== 'object' || error === null) return null
  const e = error as { code?: string; constraint?: string }
  if (e.code !== '23505') return null
  const c = e.constraint ?? ''
  if (c.includes('users_email')) return 'email'
  if (c.includes('agency_slugs_slug') || c.includes('agency_slugs_alias')) return 'slug'
  return null
}

/**
 * Ask which of the candidate alternatives are free, in one round trip, then let the
 * pure suggester choose among them.
 *
 * Generating candidates and testing them one at a time would be a query per attempt
 * on a path that is already handling a collision. Twenty at once costs the same as
 * one.
 */
async function suggestFreeSlugs(client: PoolClient, base: string): Promise<string[]> {
  const candidates = suggestSlugs(base, new Set(), 20)
  const result = await client.query<{ slug: string }>(
    'select slug from public.slugs_taken($1::text[])',
    [candidates],
  )
  const taken = new Set(result.rows.map((r) => r.slug))
  return suggestSlugs(base, taken, 3)
}
