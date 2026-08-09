import { describe, expect, it } from 'vitest'

import { validateBrand } from '../../src/onboarding/brand-form'

describe('brand form', () => {
  it('normalises long and short hex colours', () => {
    expect(validateBrand({ colorPrimary: '#2f6f4f' })).toEqual({
      ok: true,
      value: { colorPrimary: '#2F6F4F' },
    })
    expect(validateBrand({ colorPrimary: '#abc' })).toEqual({
      ok: true,
      value: { colorPrimary: '#AABBCC' },
    })
  })

  it('rejects CSS and malformed values', () => {
    expect(validateBrand({ colorPrimary: 'red' }).ok).toBe(false)
    expect(validateBrand({ colorPrimary: '#fff; color: red' }).ok).toBe(false)
  })
})
