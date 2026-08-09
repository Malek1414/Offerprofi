/**
 * Slug derivation and collision handling (F0.7).
 *
 * Acceptance: "Slug collision is handled with a suggestion, not an error page."
 *
 * The slug is the most customer-visible string the product has. It appears in the
 * Instagram bio link (`chat.{DOMAIN}/a/{slug}`), on a QR code, and in the inbound
 * alias (`anfragen-{slug}@in.{DOMAIN}`) — all of them printed, screenshotted and
 * shared by people who will never re-read them. It is effectively permanent from the
 * moment the first customer sees it.
 *
 * So the derivation is deliberately conservative. It transliterates rather than
 * strips, because "Blüten & Bänder" becoming `blten-bnder` is a name the owner will
 * not recognise as hers, and she will not notice the difference until it is on a
 * business card.
 *
 * This module is pure. Reserving the slug is a database concern (`src/auth/signup.ts`);
 * deciding what to *offer* is not, and keeping them apart means the interesting part
 * is testable without Postgres.
 */

/** Matches `isPlausibleSlug` in src/lib/agency.ts — the public route's shape check. */
export const MIN_SLUG_LENGTH = 2
export const MAX_SLUG_LENGTH = 63

/**
 * German (and broader Latin) characters that must survive romanisation.
 *
 * `String.normalize('NFD')` plus a diacritic strip handles é→e and ç→c correctly, but
 * gets German wrong in the way Germans notice: ö decomposes to o, not to oe, so
 * "Schröder" becomes `schroder` rather than `schroeder`. In DACH that reads as a
 * misspelling of the owner's own name. These are substituted before decomposition.
 */
const TRANSLITERATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ä/g, 'ae'],
  [/ö/g, 'oe'],
  [/ü/g, 'ue'],
  [/Ä/g, 'ae'],
  [/Ö/g, 'oe'],
  [/Ü/g, 'ue'],
  [/ß/g, 'ss'],
  [/æ/gi, 'ae'],
  [/ø/gi, 'oe'],
  [/å/gi, 'aa'],
  [/&/g, ' und '],
  [/@/g, ' at '],
]

/**
 * Reserved paths. A tenant slug that collided with one of these would shadow a real
 * route — `/a/api` is harmless today because the chat lives under `/a/`, but the
 * alias `anfragen-admin@` and a future `{slug}.{DOMAIN}` are not, and a slug is
 * unpickable once it is in circulation. Cheaper to refuse two dozen words now.
 */
const RESERVED = new Set([
  'admin', 'api', 'app', 'www', 'mail', 'email', 'smtp', 'imap', 'ftp', 'ns',
  'support', 'help', 'status', 'blog', 'docs', 'dev', 'staging', 'test', 'demo',
  'login', 'logout', 'signup', 'register', 'account', 'settings', 'billing',
  'a', 'q', 'f', 'anfragen', 'angebot', 'quote', 'chat', 'inbox', 'dashboard',
  'datenschutz', 'impressum', 'agb', 'privacy', 'imprint', 'terms', 'security',
  'abuse', 'postmaster', 'webmaster', 'noreply', 'no-reply', 'null', 'undefined',
])

/**
 * Turn an agency name into a candidate slug.
 *
 * Returns an empty string when nothing usable survives — a name written entirely in
 * a non-Latin script, say. The caller must treat that as "ask the owner to type one"
 * rather than inventing something, because a slug the owner cannot read is worse
 * than a slug she has to choose.
 */
export function slugify(name: string): string {
  let s = name.normalize('NFKC').toLowerCase()

  for (const [pattern, replacement] of TRANSLITERATIONS) s = s.replace(pattern, replacement)

  s = s
    // Now safe: everything that had to become two letters already has.
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')

  return s.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '')
}

export type SlugRejection = 'too_short' | 'too_long' | 'malformed' | 'reserved'

export interface SlugCheck {
  ok: boolean
  reason?: SlugRejection
}

/**
 * Is this slug well-formed and not reserved?
 *
 * Says nothing about whether it is *taken* — that needs the database, and is the one
 * question this module deliberately cannot answer.
 */
export function checkSlug(slug: string): SlugCheck {
  if (slug.length < MIN_SLUG_LENGTH) return { ok: false, reason: 'too_short' }
  if (slug.length > MAX_SLUG_LENGTH) return { ok: false, reason: 'too_long' }
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) return { ok: false, reason: 'malformed' }
  if (RESERVED.has(slug)) return { ok: false, reason: 'reserved' }
  return { ok: true }
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(slug)
}

/**
 * Offer alternatives for a slug that is taken.
 *
 * Numeric suffixes only, in order. Three reasons not to be cleverer:
 *
 *   - `lisa-meier-2` is obviously "the second Lisa Meier", which is honest. A
 *     synonym-substituted `lisa-meier-events` implies a different business.
 *   - The owner reads the suggestion aloud to check it. Digits survive that; a
 *     random suffix like `lisa-meier-k7f` does not.
 *   - Randomness would make the suggestion different on every page refresh, so the
 *     one she liked a second ago is gone.
 *
 * `taken` is supplied by the caller after a single database round trip, so this stays
 * pure and the suggestion loop does not hammer Postgres once per candidate.
 */
export function suggestSlugs(
  base: string,
  taken: ReadonlySet<string>,
  count = 3,
): string[] {
  const root = truncateForSuffix(base)
  const out: string[] = []

  for (let n = 2; out.length < count && n < 100; n++) {
    const candidate = `${root}-${n}`
    if (taken.has(candidate)) continue
    if (!checkSlug(candidate).ok) continue
    out.push(candidate)
  }

  return out
}

/**
 * Leave room for `-99` without pushing the slug past the length limit, and never cut
 * mid-word if a hyphen is close by — `lisa-meier-hochzeit-2` reads better than
 * `lisa-meier-hochzei-2`.
 */
function truncateForSuffix(base: string): string {
  const room = MAX_SLUG_LENGTH - 3
  if (base.length <= room) return base
  const cut = base.slice(0, room)
  const lastHyphen = cut.lastIndexOf('-')
  return (lastHyphen > room - 12 ? cut.slice(0, lastHyphen) : cut).replace(/-+$/, '')
}

/**
 * The inbound alias derived from a slug (F7.1).
 *
 * Here rather than in the email module because the alias and the slug must be
 * allocated in the same transaction — an agency that owns `/a/lisa-meier` but not
 * `anfragen-lisa-meier@` would have a chat link and no email channel, and nothing
 * downstream would notice until an inquiry bounced.
 */
export function aliasEmailForSlug(slug: string, inboundDomain: string): string {
  return `anfragen-${slug}@${inboundDomain}`
}
