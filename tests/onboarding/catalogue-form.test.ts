/**
 * Hand-typed catalogue items (F2.9, F2.11).
 *
 * The money parser gets the most attention here, because it is the single place where
 * a German owner's keyboard meets JavaScript's assumption that decimals use a dot.
 * `Number('78,50')` is NaN — so the naive implementation tells a wedding planner in
 * Köln that the only price format her country uses is not a number.
 */

import { describe, expect, it } from 'vitest'

import {
  defaultUnit,
  driverLabel,
  formatEuroInput,
  parseEuroAmount,
  validateCatalogueItem,
  QUANTITY_DRIVERS,
  type CatalogueItemForm,
} from '../../src/onboarding/catalogue-form'
import { cents } from '../../src/domain/money'

describe('F2.9 — parsing an amount as a German keyboard produces it', () => {
  it('reads the German decimal comma', () => {
    expect(parseEuroAmount('78,50')).toBe(7850)
    expect(parseEuroAmount('0,99')).toBe(99)
    expect(parseEuroAmount('2450,00')).toBe(245000)
  })

  it('reads the German thousands separator', () => {
    expect(parseEuroAmount('1.234,56')).toBe(123456)
    expect(parseEuroAmount('12.500,00')).toBe(1250000)
  })

  it('reads the English conventions too, because a paste brings whichever', () => {
    expect(parseEuroAmount('78.50')).toBe(7850)
    expect(parseEuroAmount('1,234.56')).toBe(123456)
  })

  it('reads a whole number written either way', () => {
    expect(parseEuroAmount('2450')).toBe(245000)
    // Grouped, so the dot is a thousands separator, not a decimal point.
    expect(parseEuroAmount('2.450')).toBe(245000)
  })

  it('treats a lone dot with fewer than three trailing digits as a decimal point', () => {
    // "1.5" is one euro fifty, not fifteen hundred. The grouping shape is what
    // distinguishes them, and only a three-digit group is a real separator.
    expect(parseEuroAmount('1.5')).toBe(150)
    expect(parseEuroAmount('1.50')).toBe(150)
  })

  it('survives a paste from the owner’s own document', () => {
    expect(parseEuroAmount('78,50 €')).toBe(7850)
    expect(parseEuroAmount('€ 1.180,00')).toBe(118000)
    expect(parseEuroAmount('1 234,56')).toBe(123456)
    expect(parseEuroAmount('145,00 EUR')).toBe(14500)
  })

  it('returns null instead of throwing on a typo', () => {
    // This runs on every keystroke's worth of user input; a throw would be a 500.
    for (const junk of ['', '   ', 'abc', '12abc', '--', '1,2,3,4a', '€']) {
      expect(parseEuroAmount(junk), `accepted ${JSON.stringify(junk)}`).toBeNull()
    }
  })

  it('refuses a negative price', () => {
    expect(parseEuroAmount('-50,00')).toBeNull()
  })

  it('round-trips through the field', () => {
    for (const value of [0, 99, 7850, 245000, 123456, 100000000]) {
      const formatted = formatEuroInput(cents(value))
      expect(parseEuroAmount(formatted), `${value} → "${formatted}"`).toBe(value)
    }
  })

  it('groups thousands, so a saved value matches the placeholder beside it', () => {
    // Rendering €5,000 as "5000,00" next to a placeholder reading "5.000,00" makes
    // the two look like different kinds of number.
    expect(formatEuroInput(cents(500000))).toBe('5.000,00')
    expect(formatEuroInput(cents(123456))).toBe('1.234,56')
    expect(formatEuroInput(cents(100000000))).toBe('1.000.000,00')
    expect(formatEuroInput(cents(7850))).toBe('78,50')
    expect(formatEuroInput(cents(0))).toBe('0,00')
  })

  it('rounds half-up at the boundary, matching the engine', () => {
    expect(parseEuroAmount('0,005')).toBe(1)
    expect(parseEuroAmount('78,505')).toBe(7851)
  })
})

const form = (over: Partial<CatalogueItemForm> = {}): CatalogueItemForm => ({
  name: 'Florale Dekoration',
  description: 'Trauung, Tischdekoration und Raumkonzept',
  unit: 'Pauschale',
  unitPrice: '1.180,00',
  floorPrice: '950,00',
  vatRate: '19',
  quantityDriver: 'flat',
  ...over,
})

const problemsFor = (over: Partial<CatalogueItemForm>) => {
  const out = validateCatalogueItem(form(over))
  return out.ok ? [] : out.problems
}

describe('F2.9 — validating an item', () => {
  it('accepts an ordinary service', () => {
    const out = validateCatalogueItem(form())
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.value.unitPriceCents).toBe(118000)
      expect(out.value.floorPriceCents).toBe(95000)
      expect(out.value.vatRate).toBe(19)
    }
  })

  it('defaults the floor to the list price when it is left blank', () => {
    // The safest reading of silence. An owner who has not thought about negotiation
    // gets a floor that permits none, rather than one of zero that permits anything.
    const out = validateCatalogueItem(form({ floorPrice: '' }))
    expect(out.ok && out.value.floorPriceCents).toBe(118000)
  })

  it('refuses a floor above the list price', () => {
    // Otherwise every quote violates its own guardrail, and the owner sees an
    // escalation she has no way to explain.
    expect(problemsFor({ floorPrice: '2.000,00' })).toEqual([
      { field: 'floorPrice', code: 'above_unit_price' },
    ])
  })

  it('allows a floor equal to the list price', () => {
    expect(problemsFor({ floorPrice: '1.180,00' })).toEqual([])
  })

  it('refuses a price of zero', () => {
    // A free service is not a catalogue item; it is a mistake, and the engine would
    // happily quote nothing for it.
    expect(problemsFor({ unitPrice: '0,00' })).toEqual([{ field: 'unitPrice', code: 'zero' }])
  })

  it('catches a stray zero', () => {
    expect(problemsFor({ unitPrice: '11800000,00' })).toEqual([
      { field: 'unitPrice', code: 'too_large' },
    ])
  })

  it('distinguishes a missing price from an unparseable one', () => {
    // Different messages: one asks her to fill the field, the other tells her the
    // format was not understood. Collapsing them makes the second one baffling.
    expect(problemsFor({ unitPrice: '' })).toEqual([{ field: 'unitPrice', code: 'missing' }])
    expect(problemsFor({ unitPrice: 'ungefähr tausend' })).toEqual([
      { field: 'unitPrice', code: 'unparseable' },
    ])
  })

  it('requires a name and a unit', () => {
    expect(problemsFor({ name: '  ' })).toEqual([{ field: 'name', code: 'missing' }])
    expect(problemsFor({ unit: '' })).toEqual([{ field: 'unit', code: 'missing' }])
  })

  it('blames one field when one field is wrong', () => {
    // With a zero list price the floor comparison used to fire too, so the owner was
    // told her floor was above the list price — about the one field she had typed
    // correctly.
    expect(problemsFor({ unitPrice: '0,00' }).map((p) => p.field)).toEqual(['unitPrice'])
  })

  it('never silently zero-rates an item', () => {
    // Number('') is 0, and 0 is a valid VAT rate, so an unanswered field used to mean
    // "0 % MwSt." — a mistake that first surfaces on an invoice.
    expect(problemsFor({ vatRate: '' })).toEqual([{ field: 'vatRate', code: 'invalid' }])
    expect(problemsFor({ vatRate: '   ' })).toEqual([{ field: 'vatRate', code: 'invalid' }])
  })

  it('accepts only the three VAT rates the engine knows', () => {
    for (const rate of ['19', '7', '0']) expect(problemsFor({ vatRate: rate })).toEqual([])
    for (const rate of ['20', '16', 'nineteen', '']) {
      expect(problemsFor({ vatRate: rate }), `accepted ${rate}`).toEqual([
        { field: 'vatRate', code: 'invalid' },
      ])
    }
  })

  it('accepts only the drivers the pricing engine implements', () => {
    for (const driver of QUANTITY_DRIVERS) {
      expect(problemsFor({ quantityDriver: driver }), `rejected ${driver}`).toEqual([])
    }
    expect(problemsFor({ quantityDriver: 'per_wedding' })).toEqual([
      { field: 'quantityDriver', code: 'invalid' },
    ])
  })

  it('reports every problem at once', () => {
    const problems = problemsFor({ name: '', unitPrice: '', vatRate: '20' })
    expect(problems.map((p) => p.field).sort()).toEqual(['name', 'unitPrice', 'vatRate'])
  })

  it('trims, so a trailing space does not become part of a quote line', () => {
    const out = validateCatalogueItem(form({ name: '  Florale Dekoration  ' }))
    expect(out.ok && out.value.name).toBe('Florale Dekoration')
  })
})

describe('F2.9 — the owner’s vocabulary, not ours', () => {
  it('labels every driver in both languages', () => {
    for (const driver of QUANTITY_DRIVERS) {
      expect(driverLabel(driver, 'de').length).toBeGreaterThan(3)
      expect(driverLabel(driver, 'en').length).toBeGreaterThan(3)
      expect(driverLabel(driver, 'de')).not.toBe(driverLabel(driver, 'en'))
      // "quantity_driver" is our word. It must never reach a screen.
      expect(driverLabel(driver, 'de')).not.toContain('_')
    }
  })

  it('suggests a unit for every driver, so she never has to invent one', () => {
    for (const driver of QUANTITY_DRIVERS) {
      expect(defaultUnit(driver).length).toBeGreaterThan(1)
    }
    expect(defaultUnit('per_guest')).toBe('Personen')
    expect(defaultUnit('flat')).toBe('Pauschale')
  })
})
