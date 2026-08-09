/**
 * POST /api/auth/signup (F0.6, F0.7).
 *
 * Creates the user, the agency, the owner membership and the slug reservation, then
 * logs the new owner straight in — asking someone to type the password they chose
 * four seconds ago is a step that exists only because it was easy to build.
 *
 * ─── On telling the caller that an email is taken ────────────────────────────
 *
 * `email_taken` is returned honestly, and that is a deliberate departure from the
 * usual advice, which is to respond identically and send a "someone tried to sign up
 * with your address" mail instead. Three reasons it does not apply here:
 *
 *   - The generic-response pattern *requires* that mail to be sendable. Outbound
 *     email is Phase 7. Until then the alternative to saying so is an owner who
 *     appears to sign up successfully and then cannot log in, with no explanation
 *     available anywhere.
 *   - What leaks is whether a *business email address* has an account with a quoting
 *     tool. These addresses are on the agency's own website and Impressum; the
 *     sensitivity is very different from a consumer service.
 *   - The signup form is throttled, so the leak is not enumerable at scale.
 *
 * Login does not make the same trade — see src/auth/login.ts, where the two failure
 * modes are genuinely indistinguishable.
 */

import { type NextRequest } from 'next/server'

import { asAnonymous, hasDatabase } from '../../../../db/client'
import { createAccountWithAgency, validateSignup } from '../../../../auth/signup'
import { login } from '../../../../auth/login'
import { branding } from '../../../../lib/branding'
import { serializeStaffCookie, staffCookieOptions } from '../../../../auth/session'
import { AuthThrottle } from '../../../../auth/throttle'
import { clientIp } from '../../../../auth/client-ip'

export const runtime = 'nodejs'

/**
 * Signup is expensive by construction: one scrypt at ~100ms and four inserts.
 * `AuthThrottle`, not the customer-facing limiter — see the header of
 * src/auth/throttle.ts for why the two are deliberately different types.
 */
const throttle = new AuthThrottle()

export async function POST(request: NextRequest): Promise<Response> {
  const ip = clientIp(request)
  const decision = throttle.check(`signup:${ip}`)
  if (decision.outcome === 'refuse') {
    return json({ status: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds }, 429, {
      'retry-after': String(decision.retryAfterSeconds),
    })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ status: 'invalid', problems: [] }, 400)
  }

  const input = body as Record<string, unknown>
  const validated = validateSignup({
    email: String(input.email ?? ''),
    password: String(input.password ?? ''),
    ownerName: String(input.ownerName ?? ''),
    agencyName: String(input.agencyName ?? ''),
    slug: input.slug ? String(input.slug) : undefined,
  })

  if (!validated.ok) return json({ status: 'invalid', problems: validated.problems }, 400)

  if (!hasDatabase()) {
    // Honest failure rather than a fake success. Before Postgres is provisioned the
    // customer-facing surfaces fall back to a demo tenant; signup cannot, because
    // there is nowhere to put the account.
    return json({ status: 'unavailable' }, 503)
  }

  const outcome = await asAnonymous(async (client) =>
    createAccountWithAgency(client, validated.value, branding().inboundDomain),
  )

  // 409 for both: the request was well-formed, something it names is already in use.
  // A slug collision is not an error the owner made — the UI renders it as an offer.
  if (outcome.status !== 'created') return json(outcome, 409)

  // Straight in. A failure here is not a failed signup — the account exists — so the
  // owner is sent to the login page rather than shown an error about her new account.
  const session = await asAnonymous(async (client) =>
    login(client, {
      email: validated.value.email,
      password: validated.value.password,
      userAgent: request.headers.get('user-agent'),
      ip,
    }),
  )

  if (session.status !== 'ok') {
    return json({ status: 'created', signedIn: false, slug: outcome.slug }, 201)
  }

  return json({ status: 'created', signedIn: true, slug: outcome.slug }, 201, {
    'set-cookie': serializeStaffCookie(
      session.session.token,
      staffCookieOptions(request.nextUrl.protocol === 'https:'),
    ),
  })
}

function json(payload: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

