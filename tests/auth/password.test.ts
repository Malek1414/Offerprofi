/**
 * D29a — password hashing for agency staff.
 */

import { describe, expect, it } from 'vitest'

import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '../../src/auth/password'

const PASSWORD = 'korrekt-pferd-batterie-heftklammer'

describe('D29a — hashing', () => {
  it('verifies a correct password', async () => {
    const stored = await hashPassword(PASSWORD)
    expect(await verifyPassword(PASSWORD, stored)).toBe(true)
  })

  it('rejects a wrong password', async () => {
    const stored = await hashPassword(PASSWORD)
    expect(await verifyPassword(PASSWORD + 'x', stored)).toBe(false)
    expect(await verifyPassword('', stored)).toBe(false)
  })

  it('never stores the password', async () => {
    const stored = await hashPassword(PASSWORD)
    expect(stored).not.toContain(PASSWORD)
  })

  it('salts, so identical passwords hash differently', async () => {
    // Without a per-hash salt, two owners with the same password share a hash and
    // one rainbow table breaks both.
    const a = await hashPassword(PASSWORD)
    const b = await hashPassword(PASSWORD)
    expect(a).not.toBe(b)
    expect(await verifyPassword(PASSWORD, a)).toBe(true)
    expect(await verifyPassword(PASSWORD, b)).toBe(true)
  })

  it('carries its own parameters, so the cost can be raised later', async () => {
    const stored = await hashPassword(PASSWORD)
    const [scheme, n, r, p] = stored.split('$')
    expect(scheme).toBe('scrypt')
    expect(Number(n)).toBeGreaterThan(1)
    expect(Number(r)).toBeGreaterThan(0)
    expect(Number(p)).toBeGreaterThan(0)
  })

  it('normalises unicode, so the same typed password verifies either way', async () => {
    // "ä" as one code point and as a + combining diaeresis look identical on screen
    // and can differ by keyboard or platform. Without NFKC the owner is locked out
    // of her own account by an invisible difference.
    const composed = 'Blütenzauber-2027!'
    const decomposed = 'Blütenzauber-2027!'
    expect(composed).not.toBe(decomposed)
    const stored = await hashPassword(composed)
    expect(await verifyPassword(decomposed, stored)).toBe(true)
  })
})

describe('D29a — malformed input fails the login, it does not crash the endpoint', () => {
  it('returns false for junk instead of throwing', async () => {
    for (const junk of [
      '',
      'not-a-hash',
      'scrypt$1$1',
      'bcrypt$2b$12$abc',
      'scrypt$abc$8$1$c2FsdA$aGFzaA',
      '$$$$$',
    ]) {
      await expect(verifyPassword(PASSWORD, junk)).resolves.toBe(false)
    }
  })

  it('refuses absurd stored parameters rather than exhausting memory', async () => {
    // A corrupted or hostile row must not be able to take the process down.
    const hostile = `scrypt$${2 ** 30}$64$16$c2FsdA$aGFzaA`
    await expect(verifyPassword(PASSWORD, hostile)).resolves.toBe(false)
  })
})

describe('D29a — length policy', () => {
  it('rejects a short password', async () => {
    await expect(hashPassword('a'.repeat(MIN_PASSWORD_LENGTH - 1))).rejects.toThrow(/at least/)
  })

  it('accepts one exactly at the floor', async () => {
    await expect(hashPassword('a'.repeat(MIN_PASSWORD_LENGTH))).resolves.toBeTruthy()
  })

  it('rejects an unbounded password', async () => {
    // Otherwise an unauthenticated caller chooses how much work we do.
    await expect(hashPassword('a'.repeat(MAX_PASSWORD_LENGTH + 1))).rejects.toThrow(/at most/)
  })

  it('has no character-class rules', async () => {
    // A long passphrase with no punctuation is stronger than "Passwort1!" and must
    // be accepted. NIST and the BSI both dropped composition rules.
    await expect(hashPassword('lisa mag blumen und lange sommerabende')).resolves.toBeTruthy()
  })
})

describe('D29a — rehashing on login', () => {
  it('does not ask to rehash a current hash', async () => {
    expect(needsRehash(await hashPassword(PASSWORD))).toBe(false)
  })

  it('asks to rehash a weaker one', async () => {
    // Raising the cost is worthless if existing accounts keep the old one forever.
    expect(needsRehash('scrypt$16384$8$1$c2FsdA$aGFzaA')).toBe(true)
  })

  it('asks to rehash anything unparseable', async () => {
    expect(needsRehash('garbage')).toBe(true)
  })
})
