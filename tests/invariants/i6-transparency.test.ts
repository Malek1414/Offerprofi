/**
 * INVARIANT 6 — transparency, so no decision is opaque.
 *
 * The customer is told at the first turn they are talking to an AI. The quote states
 * it was AI-prepared and is subject to human confirmation. Any figure can be explained
 * because the engine is deterministic and stores its full trace.
 *
 * Prevents: disclosure copy getting "cleaned up" out of existence, and a future
 * pricing change that cannot be explained to the customer who asks.
 */

import { describe, expect, it } from 'vitest'

import { DISCLOSURE_VERSION, buildDisclosure, recordDisclosure } from '../../src/domain/disclosure'
import { quoteLegalBlock, syntheticContentMarking } from '../../src/domain/legal'
import { priceQuote } from '../../src/engine/pricing'
import { fullCatalogue, minimalPricingInput } from '../fixtures/catalogue'

const base = {
  agencyName: 'Lisa Meier Hochzeiten',
  ownerName: 'Lisa',
  privacyNoticeUrl: 'https://example.test/datenschutz',
}

describe('I6 — transparency', () => {
  it('discloses AI use in the first assistant turn, in both languages', () => {
    const de = buildDisclosure({ ...base, language: 'de', formality: 'sie' })
    expect(de.openingLine).toContain('KI-Assistent')

    const en = buildDisclosure({ ...base, language: 'en', formality: 'unknown' })
    expect(en.openingLine).toContain('AI assistant')
  })

  it('mirrors Sie and Du correctly in the disclosure', () => {
    const sie = buildDisclosure({ ...base, language: 'de', formality: 'sie' })
    const du = buildDisclosure({ ...base, language: 'de', formality: 'du' })
    expect(sie.openingLine).toContain('Ihnen')
    expect(du.openingLine).toContain('dir')
    expect(sie.openingLine).not.toBe(du.openingLine)
  })

  it('keeps a persistent AI label, not only a one-off line', () => {
    const de = buildDisclosure({ ...base, language: 'de', formality: 'sie' })
    expect(de.headerLabel).toBe('KI-Assistent')
  })

  it('links the privacy notice at first contact (Art. 13)', () => {
    const de = buildDisclosure({ ...base, language: 'de', formality: 'sie' })
    expect(de.privacyLine).toContain(base.privacyNoticeUrl)
  })

  it('versions and stores what was actually shown', () => {
    const disclosure = buildDisclosure({ ...base, language: 'de', formality: 'sie' })
    const record = recordDisclosure('i1', disclosure, 'de', 'sie', '2026-08-08T10:00:00Z')
    expect(record.version).toBe(DISCLOSURE_VERSION)
    expect(record.textShown).toBe(disclosure.openingLine)
    expect(record.shownAt).toBe('2026-08-08T10:00:00Z')
  })

  it('states on the quote that it was AI-prepared and is human-reviewed', () => {
    const block = quoteLegalBlock(
      { agencyName: base.agencyName, validUntil: '2027-01-31', language: 'de' },
      'Lisa',
    )
    expect(block.aiDisclosure).toContain('KI-Assistent')
    expect(block.aiDisclosure).toContain('geprüft')
  })

  it('marks the document machine-readably as synthetic (Art. 50(2))', () => {
    const marking = syntheticContentMarking('2026-08-08T10:00:00Z')
    expect(marking['ai-generated']).toBe(true)
    expect(marking['disclosure-version']).toBeTruthy()
  })

  it('produces a calculation trace that reconstructs every figure', () => {
    const quote = priceQuote(minimalPricingInput({ guestCount: 80 }), fullCatalogue())

    // Every step of spec §7.3 that applies must be present and in order.
    const stepNumbers = quote.trace.steps.map((s) => s.step)
    expect(stepNumbers).toContain(1)
    expect(stepNumbers).toContain(4)
    expect(stepNumbers).toContain(6)
    expect(stepNumbers).toContain(8)
    expect([...stepNumbers]).toEqual([...stepNumbers].sort((a, b) => a - b))

    // The gross total on the document must be derivable from the trace alone.
    const grossStep = quote.trace.steps.find((s) => s.step === 8)
    expect(grossStep && 'gross' in grossStep ? grossStep.gross : null).toBe(quote.grossTotal)

    // And the input that produced it is stored, so the run is reproducible.
    expect(quote.trace.input.guestCount).toBe(80)
    expect(quote.trace.engineVersion).toBeTruthy()
  })

  it('is reproducible — the same input yields byte-identical output', () => {
    const input = minimalPricingInput()
    const a = priceQuote(input, fullCatalogue())
    const b = priceQuote(input, fullCatalogue())
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
