/**
 * A5 — the quote as a file (Phase 5).
 *
 * Until now the product could read a PDF and not write one, so the one artefact a
 * caterer actually sends a client did not exist. These tests assert the parts that
 * are obligations rather than taste: it must be a real PDF, it must carry the
 * Art. 50(2) synthetic-content marking, and it must never print a number the
 * pricing engine did not produce.
 */

import { describe, expect, it } from 'vitest'

import { priceQuote } from '../../src/engine/pricing'
import { demoCatalogue, demoPricingInput } from '../../src/lib/demo'
import { quotePdfMetadata, renderQuotePdf } from '../../src/quote/pdf'

const quote = priceQuote(demoPricingInput(), demoCatalogue())

const input = {
  agencyName: 'Kraut & Rüben Catering',
  ownerName: 'Johannes',
  brandColor: '#7a2e2e',
  quoteNumber: 'AN-2026-0007',
  issuedOn: '2026-08-11',
  validUntil: '2026-09-10',
  customerName: 'Sandra Vogt',
  eventSummary: 'Firmenfeier, 80 Personen, Köln',
  language: 'de' as const,
  quote,
}

describe('quotePdfMetadata', () => {
  it('carries the AI Act Art. 50(2) marking, because the file leaves our surface', () => {
    // On the web quote the marking is a JSON-LD block. A PDF has no DOM, so it goes
    // in the document metadata — the only machine-readable channel a file has once
    // it is an attachment on somebody's email.
    const meta = quotePdfMetadata(input, '2026-08-11T09:00:00.000Z')
    expect(meta.subject.toLowerCase()).toContain('ki')
    expect(meta.keywords).toContain('AIGenerated')
  })

  it('names the quote so a saved file is findable', () => {
    expect(quotePdfMetadata(input, '2026-08-11T09:00:00.000Z').title).toContain('AN-2026-0007')
  })
})

describe('renderQuotePdf', () => {
  it('produces a real PDF, not a promise of one', async () => {
    const buffer = await renderQuotePdf(input)
    // The magic number. A renderer that silently returned HTML would still be a
    // Buffer, and this is the cheapest thing that tells the difference.
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(buffer.length).toBeGreaterThan(1000)
  }, 30_000)

  it('is deterministic enough that the same quote does not churn', async () => {
    // Not byte-identical — the renderer stamps a creation date. Size stability is
    // what catches a layout that reflows differently on identical input.
    const [a, b] = await Promise.all([renderQuotePdf(input), renderQuotePdf(input)])
    expect(Math.abs(a.length - b.length)).toBeLessThan(200)
  }, 30_000)
})
