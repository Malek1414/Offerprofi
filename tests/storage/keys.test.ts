/**
 * Object keys are derived, never accepted.
 *
 * Two properties are load-bearing and neither is cosmetic:
 *
 *  1. **The key is content-addressed.** B1 requires that re-uploading the same file is
 *     a no-op rather than a duplicate. If the key contains a timestamp, a counter or a
 *     random id, the same bytes land twice and the idempotency requirement is gone —
 *     no amount of downstream deduplication puts it back.
 *  2. **The key cannot leave its tenant.** The agency id is the first path segment, so
 *     a filename is never trusted to influence where an object is written. A filename
 *     is attacker-supplied in the general case: it arrives from an upload form.
 */

import { describe, expect, it } from 'vitest'

import { objectKey } from '../../src/storage/keys'

const AGENCY = '3f1a9c52-6d4e-4b0a-9f2b-8c7d1e5a4b30'
const OTHER = '00000000-0000-4000-8000-000000000001'
// sha256 of the empty string — a real digest, so the test exercises the real shape.
const SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

describe('objectKey', () => {
  it('addresses an object by its content, so the same bytes take the same key', () => {
    const first = objectKey({ agencyId: AGENCY, scope: 'prospect-import', sha256: SHA, filename: 'leads.xlsx' })
    const second = objectKey({ agencyId: AGENCY, scope: 'prospect-import', sha256: SHA, filename: 'leads.xlsx' })

    expect(first).toBe(second)
    expect(first).toBe(`a/${AGENCY}/prospect-import/${SHA}.xlsx`)
  })

  it('gives the same bytes a different key under a different agency', () => {
    const mine = objectKey({ agencyId: AGENCY, scope: 'prospect-import', sha256: SHA, filename: 'leads.xlsx' })
    const theirs = objectKey({ agencyId: OTHER, scope: 'prospect-import', sha256: SHA, filename: 'leads.xlsx' })

    expect(mine).not.toBe(theirs)
    expect(mine.startsWith(`a/${AGENCY}/`)).toBe(true)
  })

  it('takes only the extension from the filename, never the name', () => {
    const key = objectKey({
      agencyId: AGENCY,
      scope: 'prospect-import',
      sha256: SHA,
      filename: '../../../etc/passwd.CSV',
    })

    expect(key).toBe(`a/${AGENCY}/prospect-import/${SHA}.csv`)
    expect(key).not.toContain('passwd')
    expect(key).not.toContain('..')
  })

  it('falls back to .bin rather than inventing an extension it does not know', () => {
    expect(objectKey({ agencyId: AGENCY, scope: 'prospect-import', sha256: SHA, filename: 'notes.exe' }))
      .toBe(`a/${AGENCY}/prospect-import/${SHA}.bin`)
    expect(objectKey({ agencyId: AGENCY, scope: 'prospect-import', sha256: SHA, filename: 'noextension' }))
      .toBe(`a/${AGENCY}/prospect-import/${SHA}.bin`)
  })

  it('refuses an agency id that is not a uuid', () => {
    expect(() => objectKey({ agencyId: 'a/../b', scope: 'prospect-import', sha256: SHA, filename: 'x.csv' }))
      .toThrow(/agency/i)
  })

  it('refuses a digest that is not a lowercase sha256', () => {
    expect(() => objectKey({ agencyId: AGENCY, scope: 'prospect-import', sha256: 'deadbeef', filename: 'x.csv' }))
      .toThrow(/sha256/i)
    expect(() => objectKey({ agencyId: AGENCY, scope: 'prospect-import', sha256: SHA.toUpperCase(), filename: 'x.csv' }))
      .toThrow(/sha256/i)
  })
})
