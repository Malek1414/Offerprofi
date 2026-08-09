/**
 * Where a document gets cut.
 *
 * Retrieval quality is decided here, long before any ranker runs: a price
 * separated from the dish it belongs to is two useless chunks where there was
 * one useful one.
 */

import { describe, expect, it } from 'vitest'

import { MIN_CHARS, TARGET_CHARS, chunkDocument } from '../../src/knowledge/chunk'

const offer = `Angebot für die Hochzeit Müller

Buffet Klassik, 60 Gäste, drei Gänge, 72 € pro Person.
Enthalten sind Vorspeisenvariation, zwei Hauptgänge und ein Dessertbuffet.

Servicepersonal: vier Kräfte über sechs Stunden, 42 € pro Stunde.

Zahlungsbedingungen: 30 % Anzahlung bei Bestätigung.`

describe('paragraphs are the unit', () => {
  it('keeps a price with the dish it belongs to', () => {
    // The failure that would matter. "72 € pro Person" filed on its own answers
    // no question anyone asks.
    const chunks = chunkDocument(offer)
    const withPrice = chunks.find((c) => c.text.includes('72 €'))
    expect(withPrice?.text).toContain('Buffet Klassik')
  })

  it('numbers chunks in reading order', () => {
    const chunks = chunkDocument(offer)
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i))
  })

  it('loses nothing from the document', () => {
    const joined = chunkDocument(offer)
      .map((c) => c.text)
      .join(' ')
    for (const marker of ['Müller', '72 €', '42 €', '30 %', 'Dessertbuffet']) {
      expect(joined, `lost "${marker}"`).toContain(marker)
    }
  })

  it('does not file a heading on its own', () => {
    // "Angebot für die Hochzeit Müller" is the most useful string in the
    // document and useless as a chunk by itself.
    const chunks = chunkDocument(offer)
    expect(chunks[0]?.text.length).toBeGreaterThan(MIN_CHARS / 4)
    expect(chunks[0]?.text).toContain('Buffet Klassik')
  })
})

describe('when a paragraph is too long', () => {
  it('falls back to sentences before characters', () => {
    const long = Array.from({ length: 60 }, (_, i) => `Satz nummer ${i} mit etwas Text.`).join(' ')
    const chunks = chunkDocument(long, 300)
    expect(chunks.length).toBeGreaterThan(1)
    // A sentence split leaves the punctuation attached; a character split would
    // routinely cut mid-word.
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(300)
    }
  })

  it('still indexes a wall of text with no punctuation at all', () => {
    // A pasted price table. Indexing it badly beats refusing to index it.
    const table = 'Position Menge Preis '.repeat(300)
    const chunks = chunkDocument(table, 500)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.text.length <= 500)).toBe(true)
  })
})

describe('edges', () => {
  it('returns nothing for an empty document rather than one empty chunk', () => {
    expect(chunkDocument('')).toEqual([])
    expect(chunkDocument('   \n\n  ')).toEqual([])
  })

  it('handles a document smaller than one chunk', () => {
    const chunks = chunkDocument('Mindestbestellung ab 20 Personen.')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.text).toBe('Mindestbestellung ab 20 Personen.')
  })

  it('uses a chunk size that can hold a menu block', () => {
    expect(TARGET_CHARS).toBeGreaterThan(1000)
  })
})
