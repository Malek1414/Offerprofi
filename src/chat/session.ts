/**
 * Chat sessions (F1.5).
 *
 * Acceptance: "Customer closes the tab, returns, and the thread is intact."
 *
 * The customer has no account (D11) and never will — asking a bride to register
 * before she can ask a question would cost more inquiries than it could possibly
 * protect. Continuity therefore rests entirely on a bearer token, which forces two
 * things:
 *
 *   1. **The raw token is never stored.** `chat_sessions.session_token_hash` holds a
 *      SHA-256 digest. A leaked database backup then yields no usable sessions —
 *      the same reasoning as never storing a password. The token exists in the
 *      customer's cookie and nowhere else on our side.
 *
 *   2. **The cookie is signed.** An HMAC over the token lets a forged or mangled
 *      cookie be rejected before any database lookup, which keeps a trivial forgery
 *      loop from turning into a query flood.
 *
 * TDDDG §25: this is a strictly essential cookie for a service the user explicitly
 * requested, so it needs no consent banner — and it is the *only* cookie on the
 * customer surface. Adding an analytics cookie here would forfeit that position
 * (see F1.12 and the CSP in next.config.ts).
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** Two weeks. Long enough to survive "I'll ask my fiancé and come back", short
 *  enough that an abandoned session on a shared phone does not linger for months. */
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000

export const SESSION_COOKIE_NAME = 'chat_session'

export interface MintedSession {
  /** Goes to the customer, in the cookie and the resume link. Never stored. */
  token: string
  /** Goes to `chat_sessions.session_token_hash`. Never leaves the server. */
  tokenHash: string
  resumableUntil: string
}

export function mintSession(now: Date, ttlMs: number = SESSION_TTL_MS): MintedSession {
  // 32 bytes of CSPRNG output. Guessing one is not a threat model worth modelling.
  const token = randomBytes(32).toString('base64url')
  return {
    token,
    tokenHash: hashSessionToken(token),
    resumableUntil: new Date(now.getTime() + ttlMs).toISOString(),
  }
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Sign a token for the cookie: `token.hmac`.
 *
 * The signature is not confidentiality — the token is in the cookie either way. It
 * is an integrity check we can run in microseconds, so that garbage cookies are
 * discarded before they cost a database round trip.
 */
export function signSessionCookie(token: string, secret: string): string {
  return `${token}.${hmac(token, secret)}`
}

/**
 * Verify and unpack a cookie. Returns the token, or null for anything unexpected.
 *
 * Deliberately gives no reason for the failure. A caller that could distinguish
 * "bad signature" from "malformed" learns nothing useful, and an attacker would.
 */
export function verifySessionCookie(value: string | undefined, secret: string): string | null {
  if (!value) return null
  const separator = value.lastIndexOf('.')
  if (separator <= 0) return null

  const token = value.slice(0, separator)
  const signature = value.slice(separator + 1)
  if (!token || !signature) return null

  const expected = hmac(token, secret)
  // Constant-time comparison: a byte-by-byte early exit leaks the correct prefix
  // to anyone patient enough to time it.
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return null
  if (!timingSafeEqual(a, b)) return null

  return token
}

function hmac(token: string, secret: string): string {
  if (!secret) throw new Error('session secret is not configured')
  return createHmac('sha256', secret).update(token).digest('base64url')
}

export interface StoredSession {
  id: string
  agencyId: string
  inquiryId: string | null
  sessionTokenHash: string
  resumableUntil: string
  lastSeenAt: string
}

/**
 * Is this session still resumable?
 *
 * Expiry is enforced here as well as by any query filter. A session row that
 * outlives its window because a cleanup job did not run must still be treated as
 * expired at the point of use.
 */
export function isResumable(session: StoredSession, now: Date): boolean {
  const until = Date.parse(session.resumableUntil)
  if (Number.isNaN(until)) return false
  return now.getTime() < until
}

/**
 * Match a presented token against a stored session.
 *
 * The token is hashed and compared to the stored digest; the tenant must match too,
 * so a valid session for agency A can never be replayed against agency B's chat
 * page. Both conditions, or nothing.
 */
export function matchesSession(
  session: StoredSession,
  token: string,
  agencyId: string,
  now: Date,
): boolean {
  if (session.agencyId !== agencyId) return false
  if (!isResumable(session, now)) return false

  const presented = Buffer.from(hashSessionToken(token))
  const stored = Buffer.from(session.sessionTokenHash)
  if (presented.length !== stored.length) return false
  return timingSafeEqual(presented, stored)
}

/**
 * Cookie attributes.
 *
 * `httpOnly` so no script can read it — which on this surface is belt and braces,
 * since the CSP admits no third-party script in the first place. `sameSite: 'lax'`
 * rather than 'strict' so that arriving from an Instagram bio link or an emailed
 * resume link keeps the session; 'strict' would silently drop the thread on exactly
 * the entry paths this product is reached by.
 */
export function sessionCookieOptions(secure: boolean, ttlMs: number = SESSION_TTL_MS) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: Math.floor(ttlMs / 1000),
  }
}
