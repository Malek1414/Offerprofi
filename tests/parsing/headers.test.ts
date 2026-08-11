/**
 * Two properties are under test, and only one of them is about matching words.
 *
 * The first is that the detector reads real German exports: the header is not row
 * 1, the labels are `Firma` and `Webseite` and `Branche`, and a column named `PLZ`
 * is understood and left alone rather than pressed into service as a city.
 *
 * The second is the one that would survive a rewrite of every label in the table:
 * **this module cannot produce a decision.** Every proposal carries a confidence, no
 * confidence reaches 1.0 — that value means *an owner said so* (CLAUDE.md §7) — and
 * the losing columns come back as alternatives instead of being dropped. B2 says
 * mapping is "detected, then confirmed, never guessed silently", and the assertions
 * at the bottom are what stops that from decaying into a comment.
 */

import { describe, expect, it } from 'vitest'

import {
  detectHeaderRow,
  MAX_DETECTED_CONFIDENCE,
  PROSPECT_FIELDS,
  proposeMapping,
  type ProspectField,
} from '../../src/parsing/headers'

/** An export with a title row and a blank row above the header — the normal case. */
const GERMAN_EXPORT: string[][] = [
  ['Leads Berlin Q3 2026'],
  [],
  ['Firma', 'Webseite', 'Ort', 'Land', 'Branche'],
  ['Café Kranzler', 'https://kranzler.example', 'Berlin', 'DE', 'Café'],
  ['Weinhaus Müller', 'www.weinhaus-mueller.example', 'Köln', 'DE', 'Weinhandlung'],
  ['Fingerfood Nord', 'https://ff-nord.example', 'Hamburg', 'DE', 'Catering'],
]

const columnFor = (rows: string[][], field: ProspectField): number | undefined =>
  proposeMapping(rows).proposals.find((proposal) => proposal.field === field)?.columnIndex

describe('detectHeaderRow', () => {
  it('finds a header that is not the first row', () => {
    const detected = detectHeaderRow(GERMAN_EXPORT)

    expect(detected.index).toBe(2)
    expect(detected.confidence).toBeGreaterThan(0.8)
  })

  it('offers the runners-up so a wrong pick costs one tap', () => {
    const detected = detectHeaderRow(GERMAN_EXPORT)

    expect(detected.alternatives.length).toBeGreaterThan(0)
    expect(detected.alternatives.every((row) => row.confidence <= detected.confidence)).toBe(true)
    expect(detected.alternatives.map((row) => row.index)).not.toContain(2)
  })

  it('scores a row of data far below a row of labels', () => {
    const detected = detectHeaderRow(GERMAN_EXPORT)
    const dataRow = detected.alternatives.find((row) => row.index === 3)

    expect(dataRow?.confidence ?? 0).toBeLessThan(0.5)
  })

  it('reports no header at all for empty input rather than pointing at row 0', () => {
    expect(detectHeaderRow([]).index).toBe(-1)
    expect(detectHeaderRow([[], ['', '']]).index).toBe(-1)
  })
})

describe('proposeMapping — German headers', () => {
  it('maps the five target fields off a German export', () => {
    const proposal = proposeMapping(GERMAN_EXPORT)
    const byField = Object.fromEntries(proposal.proposals.map((p) => [p.field, p.columnIndex]))

    expect(proposal.headerRowIndex).toBe(2)
    expect(byField).toEqual({
      business_name: 0,
      website_url: 1,
      city: 2,
      country: 3,
      category: 4,
    })
    expect(proposal.missing).toEqual([])
  })

  it('accepts the synonyms different exports actually use', () => {
    const rows = [
      ['Firmenname', 'Homepage', 'Stadt', 'Ländercode', 'Kategorie'],
      ['Café Kranzler', 'https://kranzler.example', 'Berlin', 'DE', 'Café'],
    ]

    expect(columnFor(rows, 'business_name')).toBe(0)
    expect(columnFor(rows, 'website_url')).toBe(1)
    expect(columnFor(rows, 'city')).toBe(2)
    expect(columnFor(rows, 'country')).toBe(3)
    expect(columnFor(rows, 'category')).toBe(4)
  })

  it('reads a hyphenated or spaced header one word at a time', () => {
    const rows = [
      ['Firmen-Name', 'Web-Seite', 'Ort'],
      ['Café Kranzler', 'https://kranzler.example', 'Berlin'],
    ]

    expect(columnFor(rows, 'business_name')).toBe(0)
    expect(columnFor(rows, 'website_url')).toBe(1)
  })

  it('does not depend on an umlaut surviving the export', () => {
    // Whether `Ländercode` arrives as itself or as `Laendercode` is a property of
    // the tool that wrote the file, not of the data.
    const withUmlaut = [['Firma', 'Ländercode'], ['Kranzler', 'DE']]
    const without = [['Firma', 'Laendercode'], ['Kranzler', 'DE']]

    expect(columnFor(withUmlaut, 'country')).toBe(1)
    expect(columnFor(without, 'country')).toBe(1)
  })

  it('accepts English headers too', () => {
    const rows = [
      ['Business Name', 'Website', 'City', 'Country', 'Category'],
      ['Kranzler', 'https://kranzler.example', 'Berlin', 'DE', 'Café'],
    ]

    expect(proposeMapping(rows).missing).toEqual([])
  })
})

describe('proposeMapping — columns that must not be misread', () => {
  it('recognises PLZ and refuses to offer it as a city', () => {
    // `PLZ` sits next to `Ort` in every German address block. A looser matcher —
    // one that scored on substrings or on "column of short values next to a city" —
    // maps it, and every prospect gets a postcode for a city.
    const rows = [
      ['Firma', 'PLZ', 'Ort'],
      ['Café Kranzler', '10117', 'Berlin'],
      ['Weinhaus Müller', '50667', 'Köln'],
      ['Fingerfood Nord', '20095', 'Hamburg'],
    ]
    const proposal = proposeMapping(rows)

    expect(proposal.columns[1]?.recognisedAs).toBe('postal_code')
    expect(proposal.columns[1]?.candidates).toEqual([])
    expect(columnFor(rows, 'city')).toBe(2)
  })

  it('does not read a contact person as the business', () => {
    const rows = [
      ['Firma', 'Ansprechpartner', 'Ort'],
      ['Café Kranzler', 'Frau Meyer', 'Berlin'],
    ]
    const proposal = proposeMapping(rows)

    expect(proposal.columns[1]?.recognisedAs).toBe('contact_person')
    expect(columnFor(rows, 'business_name')).toBe(0)
  })

  it('keeps a column whose header only partly names something we skip', () => {
    // `Firma ID` is a business column with an id suffix, not an id column. Matching
    // any single word against the skip list would lose it entirely.
    const rows = [['Firma ID', 'Ort'], ['Café Kranzler', 'Berlin']]

    expect(proposeMapping(rows).columns[0]?.recognisedAs).toBeUndefined()
    expect(columnFor(rows, 'business_name')).toBe(0)
  })
})

describe('proposeMapping — confidence and alternatives', () => {
  it('treats a bare Name as suggestive, not decisive, and keeps it as the alternative', () => {
    const rows = [
      ['Firma', 'Name', 'Ort'],
      ['Café Kranzler', 'Frau Meyer', 'Berlin'],
    ]
    const proposal = proposeMapping(rows)
    const businessName = proposal.proposals.find((p) => p.field === 'business_name')

    expect(businessName?.columnIndex).toBe(0)
    expect(businessName?.alternatives.map((alternative) => alternative.columnIndex)).toEqual([1])

    const bareName = proposal.columns[1]?.candidates.find((c) => c.field === 'business_name')
    // Below the 0.8 auto-accept line on purpose: this one always reaches a human.
    expect(bareName?.confidence).toBeLessThan(0.8)
  })

  it('reads the values when the header says nothing useful', () => {
    const rows = [
      ['Firma', 'Sonstiges', 'Ort'],
      ['Café Kranzler', 'https://kranzler.example', 'Berlin'],
      ['Weinhaus Müller', 'https://mueller.example', 'Köln'],
      ['Fingerfood Nord', 'https://ff-nord.example', 'Hamburg'],
    ]
    const proposal = proposeMapping(rows)
    const website = proposal.proposals.find((p) => p.field === 'website_url')

    expect(website?.columnIndex).toBe(1)
    expect(website?.evidence).toContain('values_match_shape')
    // Shape alone is weaker than a header that says so, and stays under the bar.
    expect(website?.confidence).toBeLessThan(0.8)
  })

  it('does not read a shape off one or two values', () => {
    const rows = [
      ['Firma', 'Sonstiges'],
      ['Café Kranzler', 'https://kranzler.example'],
    ]

    expect(columnFor(rows, 'website_url')).toBeUndefined()
  })

  it('names the fields it found nothing for', () => {
    const rows = [['Firma', 'Ort'], ['Café Kranzler', 'Berlin']]
    const proposal = proposeMapping(rows)

    expect(proposal.missing.sort()).toEqual(['category', 'country', 'website_url'])
  })

  it('returns an empty proposal rather than a guess when there is nothing to read', () => {
    const proposal = proposeMapping([])

    expect(proposal.headerRowIndex).toBe(-1)
    expect(proposal.proposals).toEqual([])
    expect(proposal.missing).toEqual([...PROSPECT_FIELDS])
  })
})

describe('proposeMapping — the confirmation guarantee', () => {
  it('never reaches the confidence reserved for a human', () => {
    // CLAUDE.md §7: owner- and form-supplied values are 1.0 and always win. A
    // detection that could reach 1.0 would be indistinguishable from a confirmation
    // the first time the two are compared with `===`.
    const proposal = proposeMapping(GERMAN_EXPORT)

    expect(MAX_DETECTED_CONFIDENCE).toBeLessThan(1)
    expect(proposal.headerRowConfidence).toBeLessThanOrEqual(MAX_DETECTED_CONFIDENCE)
    for (const entry of proposal.proposals) {
      expect(entry.confidence).toBeLessThanOrEqual(MAX_DETECTED_CONFIDENCE)
      expect(entry.confidence).toBeGreaterThan(0)
    }
    for (const column of proposal.columns) {
      for (const candidate of column.candidates) {
        expect(candidate.confidence).toBeLessThanOrEqual(MAX_DETECTED_CONFIDENCE)
      }
    }
  })

  it('says what it is, in the type', () => {
    const proposal = proposeMapping(GERMAN_EXPORT)

    // `requiresConfirmation` is the literal `true`, not a boolean: there is no value
    // of `MappingProposal` that says a mapping was confirmed, so no caller can get
    // one out of this module.
    expect(proposal.requiresConfirmation).toBe(true)
  })

  it('explains every proposal, so the confirmation screen can show why', () => {
    for (const entry of proposeMapping(GERMAN_EXPORT).proposals) {
      expect(entry.evidence.length).toBeGreaterThan(0)
      expect(entry.header).not.toBe('')
    }
  })
})
