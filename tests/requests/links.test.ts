/**
 * The token is the whole of the authorisation, so this is a test about entropy
 * and about not being clever.
 */

import { describe, expect, it } from 'vitest'

import {
  hashRequestToken,
  isPlausibleRequestToken,
  mintRequestToken,
  requestPath,
} from '../../src/requests/links'

describe('minting', () => {
  it('produces a URL-safe token long enough to be a credential', () => {
    const { token } = mintRequestToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    // 32 bytes, base64url, no padding.
    expect(token.length).toBe(43)
  })

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => mintRequestToken().token))
    expect(tokens.size).toBe(500)
  })

  it('stores a hash, not the token', () => {
    const { token, tokenHash } = mintRequestToken()
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(tokenHash).not.toContain(token)
    expect(hashRequestToken(token)).toBe(tokenHash)
  })

  it('gives the two audiences unrelated tokens', () => {
    // Deriving his from hers, however cleverly, would mean a customer holding her
    // own link holds the input to his — the one with the contact details on it.
    const hers = mintRequestToken()
    const his = mintRequestToken()
    expect(his.token).not.toContain(hers.token.slice(0, 16))
    expect(his.tokenHash).not.toBe(hers.tokenHash)
  })
})

describe('the cheap check before any lookup', () => {
  it('accepts a minted token', () => {
    expect(isPlausibleRequestToken(mintRequestToken().token)).toBe(true)
  })

  it('rejects everything that could not have been minted here', () => {
    for (const bad of ['', 'demo', '../../etc/passwd', 'a'.repeat(65), 'has spaces', 'a/b']) {
      expect(isPlausibleRequestToken(bad)).toBe(false)
    }
  })
})

describe('the path', () => {
  it('is relative, so it works on whatever host serves it', () => {
    expect(requestPath('abc')).toBe('/r/abc')
  })
})
