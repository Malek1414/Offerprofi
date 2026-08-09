/**
 * D29a — staff sessions.
 */

import { describe, expect, it } from 'vitest'

import {
  STAFF_COOKIE_NAME,
  STAFF_SESSION_TTL_MS,
  clearStaffCookie,
  hashStaffToken,
  mintStaffSession,
  normaliseEmail,
  serializeStaffCookie,
  staffCookieOptions,
  tokenHashesMatch,
} from '../../src/auth/session'
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from '../../src/chat/session'

const NOW = new Date('2026-08-09T09:00:00.000Z')

describe('D29a — minting', () => {
  it('never stores the raw token', () => {
    const minted = mintStaffSession(NOW)
    expect(minted.tokenHash).not.toBe(minted.token)
    expect(minted.tokenHash).toBe(hashStaffToken(minted.token))
    expect(minted.tokenHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('does not encode the user id in the token', () => {
    // A self-describing token would be a second source of truth about who someone
    // is. The database is the only one, and it can say "revoked".
    const minted = mintStaffSession(NOW)
    expect(minted.token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(minted.token.length).toBeGreaterThan(32)
  })

  it('mints a distinct token every time', () => {
    expect(mintStaffSession(NOW).token).not.toBe(mintStaffSession(NOW).token)
  })

  it('expires in seven days', () => {
    const minted = mintStaffSession(NOW)
    expect(minted.expiresAt.getTime() - NOW.getTime()).toBe(STAFF_SESSION_TTL_MS)
  })
})

describe('D29a — staff and customer sessions are kept apart', () => {
  it('uses a different cookie name', () => {
    // A bug that merged them would let a customer's chat cookie be presented as
    // staff credentials.
    expect(STAFF_COOKIE_NAME).not.toBe(SESSION_COOKIE_NAME)
  })

  it('expires sooner than a customer session', () => {
    // This session can read every inquiry, contact and price in the tenant.
    expect(STAFF_SESSION_TTL_MS).toBeLessThan(SESSION_TTL_MS)
  })

  it('is SameSite=Strict, unlike the chat cookie', () => {
    // Nobody deep-links into the dashboard from a third-party site, so the stricter
    // setting costs nothing and removes a class of CSRF.
    expect(staffCookieOptions(true).sameSite).toBe('strict')
  })

  it('is httpOnly', () => {
    expect(staffCookieOptions(true).httpOnly).toBe(true)
  })
})

describe('D29a — cookie serialisation', () => {
  it('emits the security attributes', () => {
    const cookie = serializeStaffCookie('abc', staffCookieOptions(true))
    expect(cookie).toContain(`${STAFF_COOKIE_NAME}=abc`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Strict')
  })

  it('omits Secure off HTTPS, so local development works', () => {
    expect(serializeStaffCookie('abc', staffCookieOptions(false))).not.toContain('Secure')
  })

  it('clears with an immediate expiry', () => {
    expect(clearStaffCookie(true)).toContain('Max-Age=0')
  })
})

describe('D29a — comparisons are constant time', () => {
  it('matches identical hashes', () => {
    const hash = hashStaffToken('token')
    expect(tokenHashesMatch(hash, hash)).toBe(true)
  })

  it('rejects different hashes and different lengths without throwing', () => {
    expect(tokenHashesMatch(hashStaffToken('a'), hashStaffToken('b'))).toBe(false)
    expect(tokenHashesMatch('short', hashStaffToken('a'))).toBe(false)
  })
})

describe('D29a — email normalisation', () => {
  it('lowercases and trims, so one mailbox is one account', () => {
    expect(normaliseEmail('  Lisa@Example.DE ')).toBe('lisa@example.de')
  })

  it('leaves dots and plus tags alone', () => {
    // Stripping them is a Gmail convention, not a rule. Applying it elsewhere
    // merges accounts that genuinely differ.
    expect(normaliseEmail('lisa.meier+angebote@ionos.de')).toBe('lisa.meier+angebote@ionos.de')
  })
})
