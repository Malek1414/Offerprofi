/**
 * Staffelpreise — tiered price bands (F4.3, completing F2.9).
 *
 * The engine already resolves overlapping and gapped bands defensively, because a
 * catalogue arriving from extraction can contain anything. This form is the other
 * side of that: what an owner types by hand should not be *able* to overlap or leave
 * a gap. So the form asks for one number per band — "ab wie vielen?" — and derives
 * every upper bound from the next band up. A ladder built that way is total and
 * non-overlapping by construction, and `resolveUnitPrice`'s tie-breaking never has to
 * run on hand-entered data at all.
 *
 * The rule worth the most here is `below_floor`. A band under the item's floor is not
 * an error the engine will surface — it silently clamps to the floor and prices
 * correctly — so an owner who sets "ab 100 Personen: 8,00 €" against a 10,00 € floor
 * gets 10,00 € on every quote and no indication why. She has to be told at the point
 * she types it, or she never finds out.
 */

import { describe, expect, it } from 'vitest'

import {
  formatQuantity,
  priceBandsToForm,
  supportsPriceBands,
  validatePriceBands,
  type PriceBandForm,
} from '../../src/onboarding/price-band-form'
import { cents } from '../../src/domain/money'
import { catalogItemId } from '../../src/domain/catalogue'

const FLOOR = { floorPriceCents: 1000 }

function rows(...pairs: Array<[string, string]>): PriceBandForm[] {
  return pairs.map(([fromQty, unitPrice]) => ({ fromQty, unitPrice }))
}

describe('F4.3 — a ladder is built from one number per band', () => {
  it('derives each upper bound from the next band up', () => {
    const result = validatePriceBands(rows(['1', '15,00'], ['50', '12,50'], ['100', '11,00']), FLOOR)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual([
      { minQty: 1, maxQty: 49, unitPriceCents: 1500 },
      { minQty: 50, maxQty: 99, unitPriceCents: 1250 },
      { minQty: 100, maxQty: null, unitPriceCents: 1100 },
    ])
  })

  it('leaves the top band open-ended, so no quantity is ever unpriced', () => {
    const result = validatePriceBands(rows(['20', '12,00']), FLOOR)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.at(-1)?.maxQty).toBeNull()
  })

  it('sorts by quantity, so the order she typed them in does not matter', () => {
    const result = validatePriceBands(rows(['100', '11,00'], ['1', '15,00'], ['50', '12,50']), FLOOR)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.map((b) => b.minQty)).toEqual([1, 50, 100])
    expect(result.value.map((b) => b.maxQty)).toEqual([49, 99, null])
  })

  it('accepts an empty ladder — most items are a single price', () => {
    const result = validatePriceBands([], FLOOR)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual([])
  })

  it('ignores a wholly blank row, so a stray empty line is not an error', () => {
    const result = validatePriceBands(rows(['50', '12,50'], ['', '']), FLOOR)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toHaveLength(1)
  })

  it('produces bands that cover every quantity with exactly one band', () => {
    const result = validatePriceBands(rows(['1', '15,00'], ['50', '12,50'], ['100', '11,00']), FLOOR)
    if (!result.ok) throw new Error('expected a valid ladder')

    for (const qty of [1, 25, 49, 50, 75, 99, 100, 500]) {
      const matching = result.value.filter(
        (b) => qty >= b.minQty && (b.maxQty === null || qty <= b.maxQty),
      )
      expect(matching, `quantity ${qty}`).toHaveLength(1)
    }
  })
})

describe('F4.3 — what the form refuses', () => {
  it('rejects two bands starting at the same quantity', () => {
    const result = validatePriceBands(rows(['50', '12,50'], ['50', '11,00']), FLOOR)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems).toContainEqual({ index: 1, field: 'fromQty', code: 'duplicate' })
  })

  it('rejects a band below the item floor, which the engine would silently clamp', () => {
    const result = validatePriceBands(rows(['100', '8,00']), FLOOR)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems).toContainEqual({ index: 0, field: 'unitPrice', code: 'below_floor' })
  })

  it('allows a band exactly at the floor', () => {
    expect(validatePriceBands(rows(['100', '10,00']), FLOOR).ok).toBe(true)
  })

  it('rejects a quantity below one', () => {
    for (const bad of ['0', '-5']) {
      const result = validatePriceBands(rows([bad, '12,50']), FLOOR)
      expect(result.ok, bad).toBe(false)
      if (result.ok) continue
      expect(result.problems).toContainEqual({ index: 0, field: 'fromQty', code: 'invalid' })
    }
  })

  it('rejects a fractional quantity — a band starting at 2.5 guests is not a thing', () => {
    const result = validatePriceBands(rows(['2,5', '12,50']), FLOOR)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems).toContainEqual({ index: 0, field: 'fromQty', code: 'invalid' })
  })

  it('rejects a price it cannot read, rather than guessing', () => {
    const result = validatePriceBands(rows(['50', 'zwölf']), FLOOR)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems).toContainEqual({ index: 0, field: 'unitPrice', code: 'unparseable' })
  })

  it('rejects a zero price — free is not a band, it is a mistake', () => {
    const result = validatePriceBands(rows(['50', '0,00']), FLOOR)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems).toContainEqual({ index: 0, field: 'unitPrice', code: 'zero' })
  })

  it('reports a half-filled row on the field that is empty', () => {
    const missingPrice = validatePriceBands(rows(['50', '']), FLOOR)
    expect(missingPrice.ok).toBe(false)
    if (!missingPrice.ok) {
      expect(missingPrice.problems).toContainEqual({ index: 0, field: 'unitPrice', code: 'missing' })
    }

    const missingQty = validatePriceBands(rows(['', '12,50']), FLOOR)
    expect(missingQty.ok).toBe(false)
    if (!missingQty.ok) {
      expect(missingQty.problems).toContainEqual({ index: 0, field: 'fromQty', code: 'missing' })
    }
  })

  it('reports problems against the row the owner typed, not the sorted position', () => {
    // Sorting happens after validation for exactly this reason: an error highlighted
    // on a different row than the one she is looking at is worse than no error.
    const result = validatePriceBands(rows(['100', '11,00'], ['50', '0,00']), FLOOR)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems).toContainEqual({ index: 1, field: 'unitPrice', code: 'zero' })
  })
})

describe('F4.3 — stored rules round-trip back into the form', () => {
  it('renders saved bands as the rows she typed', () => {
    const id = catalogItemId('11111111-1111-4111-8111-111111111111')
    const form = priceBandsToForm([
      { catalogItemId: id, minQty: 50, maxQty: 99, unitPrice: cents(1250) },
      { catalogItemId: id, minQty: 1, maxQty: 49, unitPrice: cents(1500) },
    ])

    expect(form).toEqual([
      { fromQty: '1', unitPrice: '15,00' },
      { fromQty: '50', unitPrice: '12,50' },
    ])
  })

  it('survives a save-and-reload without changing the ladder', () => {
    const original = rows(['1', '15,00'], ['50', '12,50'], ['100', '11,00'])
    const saved = validatePriceBands(original, FLOOR)
    if (!saved.ok) throw new Error('expected a valid ladder')

    const id = catalogItemId('11111111-1111-4111-8111-111111111111')
    const reloaded = priceBandsToForm(
      saved.value.map((b) => ({
        catalogItemId: id,
        minQty: b.minQty,
        maxQty: b.maxQty,
        unitPrice: cents(b.unitPriceCents),
      })),
    )

    expect(reloaded).toEqual(original)
    expect(validatePriceBands(reloaded, FLOOR)).toEqual(saved)
  })
})

describe('F4.3 — the quantity reads as the owner means it', () => {
  it('names the threshold in the unit she prices in', () => {
    expect(formatQuantity('per_guest')).toBe('Personen')
    expect(formatQuantity('per_hour')).toBe('Stunden')
    expect(formatQuantity('per_km')).toBe('km')
    expect(formatQuantity('per_item')).toBe('Stück')
    expect(formatQuantity('per_day')).toBe('Tage')
  })

  it('has no threshold unit for a flat item, because bands cannot apply to one', () => {
    // A Pauschale is one price whatever the size — there is no quantity to band on,
    // so the editor hides the ladder entirely rather than offering a broken one.
    expect(formatQuantity('flat')).toBeNull()
    expect(supportsPriceBands('flat')).toBe(false)
    expect(supportsPriceBands('per_guest')).toBe(true)
  })
})
