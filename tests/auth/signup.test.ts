/**
 * Signup validation (F0.6, F0.7).
 *
 * Acceptance under test: "A stranger can create an account unaided." That is mostly
 * a claim about *not* rejecting things — a validator that turns away a real email
 * address or a real business name fails the criterion just as surely as a missing
 * form does, and nobody who hits it will write in to complain.
 */

import { describe, expect, it } from 'vitest'

import { validateSignup, type SignupRequest } from '../../src/auth/signup'
import { MIN_PASSWORD_LENGTH } from '../../src/auth/password'

const valid: SignupRequest = {
  email: 'lisa@meier-hochzeiten.de',
  password: 'ein sehr langes passwort',
  ownerName: 'Lisa Meier',
  agencyName: 'Lisa Meier Hochzeiten',
}

const problemsFor = (over: Partial<SignupRequest>) => {
  const out = validateSignup({ ...valid, ...over })
  return out.ok ? [] : out.problems
}

describe('F0.6 — signup validation', () => {
  it('accepts an ordinary signup and derives the slug from the agency name', () => {
    const out = validateSignup(valid)
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.value.slug).toBe('lisa-meier-hochzeiten')
      expect(out.value.email).toBe('lisa@meier-hochzeiten.de')
    }
  })

  it('normalises the email so one mailbox cannot become two accounts', () => {
    const out = validateSignup({ ...valid, email: '  Lisa@Meier-Hochzeiten.DE ' })
    expect(out.ok && out.value.email).toBe('lisa@meier-hochzeiten.de')
  })

  it('accepts the address shapes a strict RFC check would wrongly reject', () => {
    // Every false rejection here is a person who cannot sign up and cannot argue.
    const addresses = [
      'lisa+anfragen@example.de',
      'l.meier@sub.domain.example.co.uk',
      'büro@example.de',
      "o'brien@example.ie",
      'a@b.co',
    ]
    for (const email of addresses) {
      expect(problemsFor({ email }), `rejected ${email}`).toEqual([])
    }
  })

  it('rejects what is plainly not an address', () => {
    for (const email of ['', 'lisa', 'lisa@', '@example.de', 'lisa@example', 'a b@c.de']) {
      expect(problemsFor({ email }).some((p) => p.field === 'email'), `accepted "${email}"`).toBe(
        true,
      )
    }
  })

  it('enforces a length floor on the password and nothing else', () => {
    expect(problemsFor({ password: 'x'.repeat(MIN_PASSWORD_LENGTH - 1) })).toEqual([
      { field: 'password', code: 'too_short' },
    ])
    // No character-class rule: a long passphrase of lowercase words is fine, and
    // demanding a symbol produces `Passwort1!` rather than security.
    expect(problemsFor({ password: 'korrektes pferd batterie klammer' })).toEqual([])
  })

  it('caps the password, because scrypt hashes whatever an anonymous caller sends', () => {
    expect(problemsFor({ password: 'x'.repeat(257) })).toEqual([
      { field: 'password', code: 'too_long' },
    ])
  })

  it('requires both names — one is the letterhead, the other is "mit Lisa sprechen"', () => {
    expect(problemsFor({ ownerName: '   ' })).toEqual([{ field: 'ownerName', code: 'missing' }])
    expect(problemsFor({ agencyName: '' }).some((p) => p.field === 'agencyName')).toBe(true)
  })

  it('reports every problem at once', () => {
    // Revealing one error per submission makes a five-field form a five-round trip.
    const problems = problemsFor({ email: 'nope', password: 'short', ownerName: '' })
    expect(problems.map((p) => p.field).sort()).toEqual(['email', 'ownerName', 'password'])
  })

  it('honours an explicit slug over the derived one', () => {
    const out = validateSignup({ ...valid, slug: 'Blüten & Bänder' })
    expect(out.ok && out.value.slug).toBe('blueten-und-baender')
  })

  it('rejects a reserved slug rather than letting it shadow a route', () => {
    expect(problemsFor({ slug: 'admin' })).toEqual([{ field: 'slug', code: 'reserved' }])
    expect(problemsFor({ agencyName: 'Demo' })).toEqual([{ field: 'slug', code: 'reserved' }])
  })

  it('says so plainly when no slug can be derived from the name', () => {
    // Rather than inventing one the owner cannot read.
    expect(problemsFor({ agencyName: '株式会社' }).some((p) => p.code === 'underivable')).toBe(true)
  })

  it('never returns a value when it returns problems', () => {
    const out = validateSignup({ ...valid, email: 'nope' })
    expect(out.ok).toBe(false)
    expect('value' in out).toBe(false)
  })
})
