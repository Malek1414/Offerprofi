/**
 * Agency theming tests.
 *
 * The point of this module is that a non-technical owner cannot produce an
 * illegible quote by picking a colour they like. These tests are that promise.
 */

import { describe, expect, it } from 'vitest'

import { buildAgencyTheme, contrastRatio, parseHex } from '../../src/lib/theme'

const ratioOnPaper = (hex: string) =>
  contrastRatio(parseHex(hex)!, parseHex('#fcfcfd')!)

const ratioOnDarkPaper = (hex: string) =>
  contrastRatio(parseHex(hex)!, parseHex('#1b1e24')!)

describe('agency theme', () => {
  it('leaves a colour alone when it already reads', () => {
    const theme = buildAgencyTheme('#1F3A5F') // a deep navy
    expect(theme.adjusted).toBe(false)
    expect(theme.brandInk.toLowerCase()).toBe('#1f3a5f')
  })

  it('rescues a pale colour that would be unreadable as text', () => {
    // Instagram-pink and pale gold are exactly what this audience picks.
    for (const hex of ['#FFD1DC', '#F5D76E', '#B8E986', '#FFFFFF']) {
      const theme = buildAgencyTheme(hex)
      expect(theme.adjusted, `${hex} should have been adjusted`).toBe(true)
      expect(ratioOnPaper(theme.brandInk), `${hex} → ${theme.brandInk}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps button labels legible on any fill', () => {
    for (const hex of ['#FFD1DC', '#1F3A5F', '#000000', '#FFFFFF', '#7F00FF', '#F5D76E']) {
      const theme = buildAgencyTheme(hex)
      const ratio = contrastRatio(parseHex(theme.brand)!, parseHex(theme.onBrand)!)
      expect(ratio, `${hex}: label on fill`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps the adjusted colour recognisably the same hue', () => {
    // A pale gold should become a deeper gold, not an arbitrary brown-black.
    const theme = buildAgencyTheme('#F5D76E')
    const original = parseHex('#F5D76E')!
    const adjusted = parseHex(theme.brandInk)!
    // Red still dominates green still dominates blue, as in the original.
    expect(adjusted.r).toBeGreaterThan(adjusted.b)
    expect(original.r).toBeGreaterThan(original.b)
  })

  it('produces a wash that stays close to paper', () => {
    for (const hex of ['#7F00FF', '#FF0000', '#1F3A5F']) {
      const theme = buildAgencyTheme(hex)
      // A panel background must never fight the text sitting on it.
      expect(ratioOnPaper(theme.brandWash)).toBeLessThan(1.4)
    }
  })

  it('falls back rather than throwing on a broken hex', () => {
    // A malformed colour in a brand profile must never stop a quote rendering —
    // the customer is waiting, and an off-brand document beats a 500.
    for (const bad of ['', 'not-a-colour', '#12345', null, undefined]) {
      const theme = buildAgencyTheme(bad)
      expect(theme.brandInk).toMatch(/^#[0-9a-f]{6}$/i)
      expect(ratioOnPaper(theme.brandInk)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('accepts shorthand hex', () => {
    expect(parseHex('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc })
  })

  describe('dark scheme', () => {
    // Regression guard. The first version of this module derived the wash by mixing
    // toward light paper and used it in both schemes, which on a dark ground put
    // pale text on a pale panel — exactly the failure the module exists to prevent.
    it('keeps brand ink readable on the dark ground', () => {
      for (const hex of ['#1F3A5F', '#000000', '#14161c', '#E8A0B4', '#7F00FF']) {
        const theme = buildAgencyTheme(hex)
        expect(
          ratioOnDarkPaper(theme.brandInkDark),
          `${hex} → ${theme.brandInkDark} on dark`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    })

    it('keeps the dark wash dark, so body text still reads on it', () => {
      for (const hex of ['#E8A0B4', '#F5D76E', '#FFFFFF', '#1F3A5F']) {
        const theme = buildAgencyTheme(hex)
        const washOnInk = contrastRatio(parseHex(theme.brandWashDark)!, parseHex('#f2f3f5')!)
        expect(washOnInk, `${hex}: dark wash vs dark-mode body text`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it('derives a different wash per scheme', () => {
      const theme = buildAgencyTheme('#E8A0B4')
      expect(theme.brandWash).not.toBe(theme.brandWashDark)
    })
  })
})
