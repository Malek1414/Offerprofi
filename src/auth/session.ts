/**
 * Staff sessions (D29a).
 *
 * The owner-side counterpart to `src/chat/session.ts`. Deliberately a separate
 * module with a separate cookie: the two have different lifetimes, different
 * revocation rules and different blast radii, and a bug that merged them would let
 * a customer's chat cookie be presented as staff credentials.
 *
 *   chat_session   customer, no account, 14 days, resumable, low privilege
 *   staff_session  agency member, real account, 7 days, revocable, full tenant access
 *
 * The token is random, hashed before storage, and never encodes the user id. A
 * self-describing token would be a second source of truth about who someone is; the
 * database is the only one, and it can say "revoked".
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const STAFF_COOKIE_NAME = 'staff_session'

/**
 * Seven days. Shorter than the customer's fourteen, because this session can read
 * every inquiry, contact and price in the tenant. Long enough that a solo owner
 * checking her phone each morning is not re-authenticating constantly.
 */
export const STAFF_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface MintedStaffSession {
  /** Goes in the cookie. Never stored, never logged. */
  token: string
  /** Goes to `user_sessions.token_hash`. */
  tokenHash: string
  expiresAt: Date
}

export function mintStaffSession(now: Date, ttlMs: number = STAFF_SESSION_TTL_MS): MintedStaffSession {
  const token = randomBytes(32).toString('base64url')
  return {
    token,
    tokenHash: hashStaffToken(token),
    expiresAt: new Date(now.getTime() + ttlMs),
  }
}

export function hashStaffToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Constant-time comparison of two token hashes.
 *
 * The database lookup is by hash and does the real work; this exists for the paths
 * that compare in application code, so they cannot accidentally use `===` and leak
 * a prefix through timing.
 */
export function tokenHashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * Cookie attributes for a staff session.
 *
 * `sameSite: 'strict'`, unlike the customer chat cookie. The chat is reached from
 * Instagram links and emails, so it needs 'lax' to survive a cross-site navigation.
 * The dashboard is not — nobody deep-links into it from a third-party site — so the
 * stricter setting costs nothing and removes a class of CSRF outright.
 */
export function staffCookieOptions(secure: boolean, ttlMs: number = STAFF_SESSION_TTL_MS) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'strict' as const,
    path: '/',
    maxAge: Math.floor(ttlMs / 1000),
  }
}

/** Serialise a Set-Cookie header value. */
export function serializeStaffCookie(
  value: string,
  options: ReturnType<typeof staffCookieOptions>,
): string {
  const parts = [
    `${STAFF_COOKIE_NAME}=${value}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    'SameSite=Strict',
  ]
  if (options.httpOnly) parts.push('HttpOnly')
  if (options.secure) parts.push('Secure')
  return parts.join('; ')
}

/** Sign-out: expire the cookie immediately. The database row is revoked separately —
 *  clearing a cookie the client controls is not, on its own, ending a session. */
export function clearStaffCookie(secure: boolean): string {
  const parts = [`${STAFF_COOKIE_NAME}=`, 'Path=/', 'Max-Age=0', 'SameSite=Strict', 'HttpOnly']
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

/**
 * Normalise an email for storage and lookup.
 *
 * Lowercased and trimmed, because `Lisa@Example.de` and `lisa@example.de` are the
 * same mailbox and a case-sensitive unique index would let both exist — two accounts
 * for one person, one of which silently stops receiving anything.
 *
 * The local part is *not* otherwise touched: stripping dots or `+tags` is a Gmail
 * convention, not a rule, and applying it to other providers merges accounts that
 * genuinely differ.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}
