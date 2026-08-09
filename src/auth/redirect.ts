/**
 * Post-login destination validation (F0.6).
 *
 * An open redirect on a login page is worth more to a phisher than one anywhere
 * else. The victim arrives on our real domain over our real certificate, sees a real
 * login form, signs in successfully — and is then handed to the attacker, with the
 * credibility of a working authentication already spent. Everything that makes a
 * login page trustworthy is what makes this bug valuable.
 *
 * The rule is therefore an allowlist of *shape*: a path on this origin, or the
 * default. Nothing here tries to parse a URL and check its host, because that is a
 * comparison against a value the deployment supplies and it has been got wrong many
 * times by people more careful than us. A string that cannot leave the origin at all
 * needs no host comparison.
 */

/**
 * The root, not a named screen.
 *
 * Where an owner belongs after signing in depends on her state: an incomplete
 * catalogue means onboarding, a live one means the inbox. Hardcoding either here
 * would send half of them to the wrong place — and pointing at `/inbox` before
 * Phase 6 exists sent all of them to a 404. `/` resolves it against the database
 * (src/app/page.tsx) and forwards.
 */
export const DEFAULT_DESTINATION = '/'

/**
 * The four shapes that must be refused, each of which defeats a naive
 * `startsWith('/')` check:
 *
 *   `//evil.example/x`   protocol-relative — another origin despite the leading slash
 *   `/\evil.example`     browsers normalise the backslash to a slash, same effect
 *   `https://evil...`    absolute, obviously
 *   `/x?next=...`        harmless here, but a control character in the value could
 *                        split a header if this ever reaches one
 */
export function safeDestination(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) return DEFAULT_DESTINATION
  if (!value.startsWith('/')) return DEFAULT_DESTINATION
  if (value.startsWith('//')) return DEFAULT_DESTINATION
  if (value.includes('\\')) return DEFAULT_DESTINATION
  // Control characters, including CR and LF. A newline in a Location header is
  // response splitting; a tab or a null is a normalisation trick. The lint rule
  // assumes a control character in a pattern is a typo — here it is the subject.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return DEFAULT_DESTINATION
  return value
}
