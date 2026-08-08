/**
 * Golden-set pricing tests (FEATURE_INVENTORY F4.2, F4.3, F4.6, F4.8).
 *
 * Expected totals are written out in full rather than computed, because a test that
 * recomputes the implementation's own arithmetic proves nothing. Where a number looks
 * surprising, the comment explains why it is right.
 */

import { describe, expect, it } from 'vitest'

import { priceQuote, reduceScopeToBudget } from '../../src/engine/pricing'
import { eurosToCents } from '../../src/domain/money'
import {
  ITEM_CATERING,
  ITEM_DECOR,
  ITEM_DJ,
  ITEM_PLANNING,
  ITEM_TRAVEL,
  PKG_CLASSIC,
  fullCatalogue,
  minimalCatalogue,
  minimalPricingInput,
} from '../fixtures/catalogue'

const wedding = () =>
  minimalPricingInput({
    serviceIds: [ITEM_PLANNING, ITEM_CATERING, ITEM_DJ, ITEM_TRAVEL],
    guestCount: 80,
    durationHours: 8,
    distanceKm: 40,
  })

describe('pricing — golden set', () => {
  it('prices a standard 80-guest wedding to the cent', () => {
    const q = priceQuote(wedding(), minimalCatalogue())

    expect(q.lines).toHaveLength(4)

    // Planning: flat fee, no tier applies.
    const planning = q.lines.find((l) => l.catalogItemId === ITEM_PLANNING)!
    expect(planning.quantity).toBe(1)
    expect(planning.unitPrice).toBe(245_000)
    expect(planning.net).toBe(245_000)
    expect(planning.vat).toBe(46_550) // 19%

    // Catering: 80 guests lands in the 50–99 band at €72.00, not the €78.50 list price.
    const catering = q.lines.find((l) => l.catalogItemId === ITEM_CATERING)!
    expect(catering.quantity).toBe(80)
    expect(catering.unitPrice).toBe(7_200)
    expect(catering.net).toBe(576_000)
    expect(catering.vat).toBe(40_320) // 7% — food is reduced-rate

    const dj = q.lines.find((l) => l.catalogItemId === ITEM_DJ)!
    expect(dj.quantity).toBe(8)
    expect(dj.net).toBe(116_000)

    const travel = q.lines.find((l) => l.catalogItemId === ITEM_TRAVEL)!
    expect(travel.quantity).toBe(40)
    expect(travel.net).toBe(3_400) // 40 km × €0.85

    expect(q.netTotal).toBe(940_400)
    expect(q.grossTotal).toBe(1_049_956) // €10,499.56
  })

  it('splits VAT into 19% and 7% buckets', () => {
    const q = priceQuote(wedding(), minimalCatalogue())
    const rates = q.vatBreakdown.map((v) => v.rate)
    expect(rates).toEqual([19, 7]) // sorted high to low

    const standard = q.vatBreakdown.find((v) => v.rate === 19)!
    expect(standard.net).toBe(364_400)
    expect(standard.vat).toBe(69_236)

    const reduced = q.vatBreakdown.find((v) => v.rate === 7)!
    expect(reduced.net).toBe(576_000)
    expect(reduced.vat).toBe(40_320)
  })

  it('sums totals from already-rounded lines, matching German accounting software', () => {
    // June is peak season: +15% per line. This is the case where the rule bites.
    const q = priceQuote({ ...wedding(), eventDate: '2027-06-12' }, fullCatalogue())

    const planning = q.lines.find((l) => l.catalogItemId === ITEM_PLANNING)!
    expect(planning.modifierTotal).toBe(36_750) // 15% of 245,000
    expect(planning.net).toBe(281_750)
    // 281,750 × 19% = 53,532.5 → half-up → 53,533.
    expect(planning.vat).toBe(53_533)

    const standard = q.vatBreakdown.find((v) => v.rate === 19)!
    // Summed from rounded lines: 53,533 + 25,346 + 743 = 79,622.
    // Rounding the bucket instead would give 419,060 × 19% = 79,621.4 → 79,621.
    // The one-cent difference is the whole point of spec §7.5.
    expect(standard.net).toBe(419_060)
    expect(standard.vat).toBe(79_622)

    expect(q.netTotal).toBe(1_081_460)
    expect(q.grossTotal).toBe(1_207_450) // €12,074.50
  })

  it('applies tiered price rules at the band edges', () => {
    const at49 = priceQuote(
      minimalPricingInput({ serviceIds: [ITEM_CATERING], guestCount: 49 }),
      minimalCatalogue(),
    )
    const at50 = priceQuote(
      minimalPricingInput({ serviceIds: [ITEM_CATERING], guestCount: 50 }),
      minimalCatalogue(),
    )
    const at99 = priceQuote(
      minimalPricingInput({ serviceIds: [ITEM_CATERING], guestCount: 99 }),
      minimalCatalogue(),
    )
    const at100 = priceQuote(
      minimalPricingInput({ serviceIds: [ITEM_CATERING], guestCount: 100 }),
      minimalCatalogue(),
    )

    expect(at49.lines[0]!.unitPrice).toBe(7_850)
    expect(at50.lines[0]!.unitPrice).toBe(7_200)
    expect(at99.lines[0]!.unitPrice).toBe(7_200)
    expect(at100.lines[0]!.unitPrice).toBe(6_800)
  })

  it('applies reverse charge as 0% across every line', () => {
    const q = priceQuote({ ...wedding(), reverseCharge: true }, minimalCatalogue())
    expect(q.vatBreakdown).toEqual([{ rate: 0, net: 940_400, vat: 0 }])
    expect(q.grossTotal).toBe(q.netTotal)
  })

  it('expands a package into its member items without double-charging', () => {
    const q = priceQuote(
      minimalPricingInput({ serviceIds: [ITEM_DECOR], packageIds: [PKG_CLASSIC] }),
      fullCatalogue(),
    )
    // Decor is in the package and also requested directly. It appears once.
    expect(q.lines.filter((l) => l.catalogItemId === ITEM_DECOR)).toHaveLength(1)
    expect(q.lines).toHaveLength(2)
    expect(q.lines.every((l) => l.fromPackageId === PKG_CLASSIC)).toBe(true)
  })

  it('collects unknown service ids instead of inventing a price', () => {
    const q = priceQuote(
      minimalPricingInput({ serviceIds: ['itm_does_not_exist' as never] }),
      minimalCatalogue(),
    )
    expect(q.unknownServiceIds).toEqual(['itm_does_not_exist'])
    expect(q.lines).toHaveLength(0)
  })

  it('never prices a line below its floor, even when a tier says otherwise', () => {
    const catalogue = minimalCatalogue()
    catalogue.priceRules.push({
      catalogItemId: ITEM_CATERING,
      minQty: 150,
      maxQty: null,
      unitPrice: eurosToCents(10), // below the €65 floor — a catalogue misconfiguration
    })
    const q = priceQuote(
      minimalPricingInput({ serviceIds: [ITEM_CATERING], guestCount: 200 }),
      catalogue,
    )
    expect(q.lines[0]!.unitPrice).toBe(6_500) // the floor, not €10
  })

  it('records every modifier individually in the trace', () => {
    const q = priceQuote(
      { ...wedding(), eventDate: '2027-06-12', availability: 'below_lead_time' },
      fullCatalogue(),
    )
    const kinds = new Set(q.modifiers.map((m) => m.kind))
    expect(kinds.has('peak_season')).toBe(true)
    expect(kinds.has('rush')).toBe(true)

    // Each carries a human-readable reason, so the owner can explain it on the phone.
    for (const m of q.modifiers) {
      expect(m.reason.length).toBeGreaterThan(5)
      expect(m.delta).not.toBe(0)
    }
  })

  it('is pure — repeated runs and shared catalogues do not drift', () => {
    const catalogue = fullCatalogue()
    const input = wedding()
    const first = priceQuote(input, catalogue)
    const second = priceQuote(input, catalogue)
    const third = priceQuote(input, catalogue)
    expect(first.grossTotal).toBe(second.grossTotal)
    expect(second.grossTotal).toBe(third.grossTotal)
    expect(JSON.stringify(first.lines)).toBe(JSON.stringify(third.lines))
  })
})

describe('pricing — budget handling (spec §7.4)', () => {
  it('returns the full quote untouched when it already fits', () => {
    const { variant, removed, fits } = reduceScopeToBudget(
      wedding(),
      minimalCatalogue(),
      eurosToCents(20_000),
    )
    expect(fits).toBe(true)
    expect(removed).toEqual([])
    expect(variant.grossTotal).toBe(1_049_956)
  })

  it('drops catalogue lines to fit a budget, and never discounts', () => {
    const { variant, removed, fits } = reduceScopeToBudget(
      wedding(),
      minimalCatalogue(),
      eurosToCents(8_000),
    )
    expect(fits).toBe(true)
    expect(removed.length).toBeGreaterThan(0)
    expect(variant.grossTotal).toBeLessThanOrEqual(eurosToCents(8_000))

    // Every surviving line is still at its catalogue price. Scope shrank; prices did not.
    for (const line of variant.lines) {
      expect(line.unitPrice).toBeGreaterThanOrEqual(line.floorPrice)
    }
  })

  it('never proposes an empty quote, even for an impossible budget', () => {
    const { variant, fits } = reduceScopeToBudget(
      wedding(),
      minimalCatalogue(),
      eurosToCents(50),
    )
    expect(fits).toBe(false)
    // The caller escalates to the owner. What it must never do is tell the customer
    // they cannot be served (I1), so there is still something to talk about.
    expect(variant.lines.length).toBeGreaterThan(0)
  })
})
