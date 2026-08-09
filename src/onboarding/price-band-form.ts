/**
 * Staffelpreise — tiered price bands, entered by hand (F4.3, completing F2.9).
 *
 * `price_rules` has been modelled, migrated and read by the engine since Phase 4, but
 * screen S17 only ever exposed a single unit price. An agency that prices per head in
 * bands — which is most of them, once a guest count is involved — could not express
 * the thing it actually charges.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE NUMBER PER BAND, AND THE LADDER CANNOT BE MALFORMED.
 *
 * `PriceRule` carries `minQty` and `maxQty`, and `resolveUnitPrice` goes to some
 * trouble over bands that overlap or leave gaps — it has to, because a catalogue
 * arriving from extraction can contain anything.
 *
 * Hand entry is not that situation, and exposing both bounds here would import the
 * whole problem for no gain: an owner who types 1–50 and 60–100 has silently left
 * 51–59 priced at the base rate, and nothing in the product would tell her. So the
 * form asks only "ab wie vielen?" and derives every upper bound from the next band
 * up. The resulting ladder is total and non-overlapping by construction, and
 * `resolveUnitPrice`'s tie-breaking never runs on hand-entered data at all.
 *
 * The cost is that a non-contiguous ladder cannot be expressed here. That is the
 * right trade — nobody has asked for one, and the failure it prevents is silent.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { formatEuroInput, parseEuroAmount } from './catalogue-form'
import type { PriceRule, QuantityDriver } from '../domain/catalogue'

/** One row as it appears on screen: a threshold and the price above it. */
export interface PriceBandForm {
  fromQty: string
  unitPrice: string
}

export type PriceBandProblem =
  | { index: number; field: 'fromQty'; code: 'missing' | 'invalid' | 'duplicate' }
  | {
      index: number
      field: 'unitPrice'
      code: 'missing' | 'unparseable' | 'zero' | 'too_large' | 'below_floor'
    }

export interface ValidatedPriceBand {
  minQty: number
  maxQty: number | null
  unitPriceCents: number
}

const MAX_PRICE_CENTS = 100_000_000
const MAX_QTY = 100_000

export function validatePriceBands(
  forms: readonly PriceBandForm[],
  item: { floorPriceCents: number },
): { ok: true; value: ValidatedPriceBand[] } | { ok: false; problems: PriceBandProblem[] } {
  const problems: PriceBandProblem[] = []
  const parsed: Array<{ index: number; minQty: number; unitPriceCents: number }> = []
  const seen = new Map<number, number>()

  forms.forEach((form, index) => {
    const rawQty = (form.fromQty ?? '').trim()
    const rawPrice = (form.unitPrice ?? '').trim()

    // A row with nothing in it is not a mistake — it is the empty row the editor keeps
    // at the bottom, or one she cleared to delete. Dropped silently.
    if (!rawQty && !rawPrice) return

    let minQty: number | null = null
    if (!rawQty) {
      problems.push({ index, field: 'fromQty', code: 'missing' })
    } else if (!/^\d+$/.test(rawQty)) {
      // Deliberately strict: `Number('2,5')` is NaN but `Number('2.5')` is 2.5, and a
      // band starting at two and a half guests is not a thing anyone means.
      problems.push({ index, field: 'fromQty', code: 'invalid' })
    } else {
      const value = Number(rawQty)
      if (value < 1 || value > MAX_QTY || !Number.isSafeInteger(value)) {
        problems.push({ index, field: 'fromQty', code: 'invalid' })
      } else if (seen.has(value)) {
        // Two bands from the same threshold have no defined order between them, and
        // the price would depend on which row happened to be stored first.
        problems.push({ index, field: 'fromQty', code: 'duplicate' })
      } else {
        seen.set(value, index)
        minQty = value
      }
    }

    let unitPriceCents: number | null = null
    if (!rawPrice) {
      problems.push({ index, field: 'unitPrice', code: 'missing' })
    } else {
      const price = parseEuroAmount(rawPrice)
      if (price === null) {
        problems.push({ index, field: 'unitPrice', code: 'unparseable' })
      } else if (price === 0) {
        problems.push({ index, field: 'unitPrice', code: 'zero' })
      } else if (price > MAX_PRICE_CENTS) {
        problems.push({ index, field: 'unitPrice', code: 'too_large' })
      } else if (price < item.floorPriceCents) {
        // The engine clamps a sub-floor band up to the floor and prices correctly, so
        // this never surfaces as an error anywhere downstream — she would simply see a
        // price she did not set, on every quote, with nothing to explain it.
        problems.push({ index, field: 'unitPrice', code: 'below_floor' })
      } else {
        unitPriceCents = price
      }
    }

    if (minQty !== null && unitPriceCents !== null) {
      parsed.push({ index, minQty, unitPriceCents })
    }
  })

  if (problems.length > 0) return { ok: false, problems }

  // Sorted only now that everything is valid. Problems are reported against the row
  // she typed — an error highlighted on a different row than the one she is looking
  // at is worse than no error at all.
  const ascending = [...parsed].sort((a, b) => a.minQty - b.minQty)

  const value = ascending.map((band, i) => ({
    minQty: band.minQty,
    // The top band is open-ended, so no quantity is ever left unpriced.
    maxQty: i === ascending.length - 1 ? null : ascending[i + 1]!.minQty - 1,
    unitPriceCents: band.unitPriceCents,
  }))

  return { ok: true, value }
}

/** Stored rules back into editable rows, in the order they read on screen. */
export function priceBandsToForm(rules: readonly PriceRule[]): PriceBandForm[] {
  return [...rules]
    .sort((a, b) => a.minQty - b.minQty)
    .map((rule) => ({
      fromQty: String(rule.minQty),
      unitPrice: formatEuroInput(rule.unitPrice),
    }))
}

/**
 * The unit a threshold is counted in, or `null` for a driver that has no quantity.
 *
 * Deliberately shorter than `defaultUnit` reads on a quote line: this appears inline
 * after a number field, as "ab [ 50 ] Personen".
 */
export function formatQuantity(driver: QuantityDriver): string | null {
  const units: Record<QuantityDriver, string | null> = {
    flat: null,
    per_guest: 'Personen',
    per_hour: 'Stunden',
    per_km: 'km',
    per_day: 'Tage',
    per_item: 'Stück',
  }
  return units[driver]
}

/**
 * Whether bands can apply at all.
 *
 * A Pauschale is one price whatever the size, so there is no quantity to band on. The
 * editor hides the ladder for one rather than offering a control that cannot work.
 */
export function supportsPriceBands(driver: QuantityDriver): boolean {
  return formatQuantity(driver) !== null
}
