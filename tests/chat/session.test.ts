/**
 * F1.5 — chat sessions.
 *
 * Acceptance: "Customer closes the tab, returns, and the thread is intact."
 */

import { describe, expect, it } from 'vitest'

import {
  SESSION_TTL_MS,
  type StoredSession,
  hashSessionToken,
  isResumable,
  matchesSession,
  mintSession,
  sessionCookieOptions,
  signSessionCookie,
  verifySessionCookie,
} from '../../src/chat/session'

const SECRET = 'test-secret-not-a-real-one'
const NOW = new Date('2026-08-08T10:00:00.000Z')

function storedFrom(minted: ReturnType<typeof mintSession>): StoredSession {
  return {
    id: 'sess_1',
    agencyId: 'agency_1',
    inquiryId: 'inq_1',
    sessionTokenHash: minted.tokenHash,
    resumableUntil: minted.resumableUntil,
    lastSeenAt: NOW.toISOString(),
  }
}

describe('F1.5 — minting', () => {
  it('never stores the raw token', () => {
    // The digest is what goes to chat_sessions.session_token_hash. A leaked
    // backup must not yield usable sessions.
    const minted = mintSession(NOW)
    expect(minted.tokenHash).not.toBe(minted.token)
    expect(minted.tokenHash).toBe(hashSessionToken(minted.token))
    expect(minted.tokenHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('mints a distinct token every time', () => {
    const a = mintSession(NOW)
    const b = mintSession(NOW)
    expect(a.token).not.toBe(b.token)
  })

  it('sets the resumable window from the TTL', () => {
    const minted = mintSession(NOW)
    expect(Date.parse(minted.resumableUntil) - NOW.getTime()).toBe(SESSION_TTL_MS)
  })
})

describe('F1.5 — cookie signing', () => {
  it('round-trips a signed cookie', () => {
    const { token } = mintSession(NOW)
    expect(verifySessionCookie(signSessionCookie(token, SECRET), SECRET)).toBe(token)
  })

  it('rejects a tampered token', () => {
    const { token } = mintSession(NOW)
    const cookie = signSessionCookie(token, SECRET)
    const tampered = `x${cookie.slice(1)}`
    expect(verifySessionCookie(tampered, SECRET)).toBeNull()
  })

  it('rejects a cookie signed with a different secret', () => {
    const { token } = mintSession(NOW)
    expect(verifySessionCookie(signSessionCookie(token, 'other-secret'), SECRET)).toBeNull()
  })

  it('rejects malformed and missing cookies without throwing', () => {
    expect(verifySessionCookie(undefined, SECRET)).toBeNull()
    expect(verifySessionCookie('', SECRET)).toBeNull()
    expect(verifySessionCookie('no-separator', SECRET)).toBeNull()
    expect(verifySessionCookie('.onlysig', SECRET)).toBeNull()
    expect(verifySessionCookie('token.', SECRET)).toBeNull()
  })

  it('refuses to sign with an unset secret rather than signing with an empty one', () => {
    expect(() => signSessionCookie('t', '')).toThrow(/secret/)
  })
})

describe('F1.5 — resuming a thread', () => {
  it('matches a valid token for the right tenant', () => {
    const minted = mintSession(NOW)
    const session = storedFrom(minted)
    // The customer closes the tab and comes back an hour later.
    const later = new Date(NOW.getTime() + 60 * 60 * 1000)
    expect(matchesSession(session, minted.token, 'agency_1', later)).toBe(true)
  })

  it('refuses a session replayed against another tenant', () => {
    const minted = mintSession(NOW)
    expect(matchesSession(storedFrom(minted), minted.token, 'agency_2', NOW)).toBe(false)
  })

  it('refuses a token that does not hash to the stored digest', () => {
    const minted = mintSession(NOW)
    const other = mintSession(NOW)
    expect(matchesSession(storedFrom(minted), other.token, 'agency_1', NOW)).toBe(false)
  })

  it('treats an expired session as expired even if the row still exists', () => {
    // Enforced at the point of use, not only by a cleanup job that may not run.
    const minted = mintSession(NOW)
    const afterExpiry = new Date(NOW.getTime() + SESSION_TTL_MS + 1)
    expect(isResumable(storedFrom(minted), afterExpiry)).toBe(false)
    expect(matchesSession(storedFrom(minted), minted.token, 'agency_1', afterExpiry)).toBe(false)
  })

  it('treats an unparseable expiry as expired, not as forever', () => {
    const session = { ...storedFrom(mintSession(NOW)), resumableUntil: 'soon' }
    expect(isResumable(session, NOW)).toBe(false)
  })
})

describe('F1.5 — cookie attributes', () => {
  it('is httpOnly and lax so entry from Instagram or an email link keeps the thread', () => {
    const options = sessionCookieOptions(true)
    expect(options.httpOnly).toBe(true)
    expect(options.secure).toBe(true)
    // 'strict' would drop the session on exactly the entry paths this product is
    // reached by (F1.4: Instagram bio link, QR, emailed resume link).
    expect(options.sameSite).toBe('lax')
  })
})
