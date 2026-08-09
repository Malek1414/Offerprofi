/**
 * Validating a hand-typed catalogue item (F2.9, F2.11).
 *
 * This is the *manual* path — the fallback for when extraction is poor or the three
 * uploaded quotes disagree, which CLAUDE.md open question #5 flags as needing an
 * explicit route. It is also the path a careful owner will use anyway, because typing
 * five services she knows by heart is faster than reviewing five guesses.
 *
 * Pure. Nothing here touches the database, so every rule about what makes an item
 * acceptable is testable on its own, and the SQL next door has nothing in it to
 * reason about.
 */

import { cents, type Cents } from '../domain/money'
import type { QuantityDriver, VatRate } from '../domain/catalogue'

/**
 * Parse an amount the way a German keyboard produces it.
 *
 * `Number('78,50')` is NaN, and `eurosToCents` would throw — so an owner typing the
 * only format her country uses would be told her price is not a number. Both
 * conventions are accepted, because a phone keyboard and a laptop numpad do not
 * agree, and a spreadsheet paste brings whichever the sheet was set to:
 *
 *   "78,50"     → 7850   German decimal comma
 *   "78.50"     → 7850   the other one, unambiguous here
 *   "1.234,56"  → 123456 German thousands separator
 *   "1,234.56"  → 123456 English thousands separator
 *   "1 234,56"  → 123456 with a space or a narrow no-break space
 *   "78,50 €"   → 7850   pasted from her own quote
 *
 * Returns null rather than throwing, because this runs on user input and a throw
 * here would be a 500 on a typo.
 */
export function parseEuroAmount(input: string): Cents | null {
  const trimmed = input
    .trim()
    // Currency symbols and the words around them, so a paste from her own document
    // works without cleaning it first.
    .replace(/[\u20ac\s\u00a0\u202f]|EUR/gi, '')
  if (!trimmed) return null
  if (!/^[0-9.,]+$/.test(trimmed)) return null

  const lastComma = trimmed.lastIndexOf(',')
  const lastDot = trimmed.lastIndexOf('.')

  let normalised: string
  if (lastComma === -1 && lastDot === -1) {
    normalised = trimmed
  } else if (lastComma > lastDot) {
    // Comma is rightmost, so it is the decimal separator: "1.234,56".
    normalised = trimmed.replace(/\./g, '').replace(',', '.')
  } else if (lastDot > lastComma) {
    // Dot is rightmost. Ambiguous for "1.234" — is that one thousand two hundred and
    // thirty-four, or 1.234 euros? Treated as a thousands separator only when the
    // group after it is exactly three digits and there is more than one group, which
    // is the shape a thousands separator actually takes.
    const looksGrouped = /^\d{1,3}(\.\d{3})+$/.test(trimmed.replace(/,/g, ''))
    normalised = looksGrouped
      ? trimmed.replace(/[.,]/g, '')
      : trimmed.replace(/,/g, '')
  } else {
    normalised = trimmed
  }

  const value = Number(normalised)
  if (!Number.isFinite(value) || value < 0) return null
  // Half-up at the boundary, matching the engine's rounding (money.ts).
  const asCents = Math.round(value * 100 + Number.EPSILON)
  if (!Number.isSafeInteger(asCents)) return null
  return cents(asCents)
}

/**
 * Format cents back into the field, so a saved value round-trips as she typed it.
 *
 * With the thousands separator, because the field next to it carries a placeholder of
 * `5.000,00` and rendering the saved value as `5000,00` makes the two look like
 * different kinds of number. `parseEuroAmount` reads it back unchanged.
 */
export function formatEuroInput(value: Cents): string {
  const [whole = '0', fraction = '00'] = (value / 100).toFixed(2).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${grouped},${fraction}`
}

export interface CatalogueItemForm {
  name: string
  description: string
  unit: string
  /** As typed. Parsed here, not by the caller. */
  unitPrice: string
  /** D8 — the hard floor the agent may never quote below. */
  floorPrice: string
  vatRate: string
  quantityDriver: string
}

export type CatalogueProblem =
  | { field: 'name'; code: 'missing' | 'too_long' }
  | { field: 'description'; code: 'too_long' }
  | { field: 'unit'; code: 'missing' | 'too_long' }
  | { field: 'unitPrice'; code: 'missing' | 'unparseable' | 'zero' | 'too_large' }
  | { field: 'floorPrice'; code: 'unparseable' | 'above_unit_price' | 'too_large' }
  | { field: 'vatRate'; code: 'invalid' }
  | { field: 'quantityDriver'; code: 'invalid' }

export interface ValidatedCatalogueItem {
  name: string
  description: string
  unit: string
  unitPriceCents: number
  floorPriceCents: number
  vatRate: VatRate
  quantityDriver: QuantityDriver
}

const MAX_NAME = 120
const MAX_DESCRIPTION = 600
const MAX_UNIT = 40
/** €1,000,000 as cents. Above this is a typo — a stray zero, or cents typed as euros. */
const MAX_PRICE_CENTS = 100_000_000

const VAT_RATES: readonly VatRate[] = [19, 7, 0]
const DRIVERS: readonly QuantityDriver[] = [
  'flat',
  'per_guest',
  'per_hour',
  'per_km',
  'per_day',
  'per_item',
]

export function validateCatalogueItem(
  form: CatalogueItemForm,
): { ok: true; value: ValidatedCatalogueItem } | { ok: false; problems: CatalogueProblem[] } {
  const problems: CatalogueProblem[] = []

  const name = (form.name ?? '').trim()
  if (!name) problems.push({ field: 'name', code: 'missing' })
  else if (name.length > MAX_NAME) problems.push({ field: 'name', code: 'too_long' })

  const description = (form.description ?? '').trim()
  if (description.length > MAX_DESCRIPTION) {
    problems.push({ field: 'description', code: 'too_long' })
  }

  const unit = (form.unit ?? '').trim()
  if (!unit) problems.push({ field: 'unit', code: 'missing' })
  else if (unit.length > MAX_UNIT) problems.push({ field: 'unit', code: 'too_long' })

  const unitPrice = parseEuroAmount(form.unitPrice ?? '')
  let unitPriceUsable = false
  if (!form.unitPrice?.trim()) problems.push({ field: 'unitPrice', code: 'missing' })
  else if (unitPrice === null) problems.push({ field: 'unitPrice', code: 'unparseable' })
  else if (unitPrice === 0) problems.push({ field: 'unitPrice', code: 'zero' })
  else if (unitPrice > MAX_PRICE_CENTS) problems.push({ field: 'unitPrice', code: 'too_large' })
  else unitPriceUsable = true

  // An empty floor means "the list price is the floor" — the safest default, and the
  // one an owner who has not thought about negotiation would want. Never zero, which
  // would silently permit the agent to go to nothing.
  let floorPrice: Cents | null = unitPrice
  if (form.floorPrice?.trim()) {
    floorPrice = parseEuroAmount(form.floorPrice)
    if (floorPrice === null) problems.push({ field: 'floorPrice', code: 'unparseable' })
    else if (floorPrice > MAX_PRICE_CENTS) {
      problems.push({ field: 'floorPrice', code: 'too_large' })
    } else if (unitPriceUsable && unitPrice !== null && floorPrice > unitPrice) {
      // A floor above the list price makes every quote violate its own guardrail, and
      // the failure would surface later as an escalation the owner cannot explain.
      //
      // Only compared when the list price is itself usable. Otherwise a mistyped list
      // price produces two errors — and the second one blames the floor, which is the
      // field that is actually correct. One wrong value, one message.
      problems.push({ field: 'floorPrice', code: 'above_unit_price' })
    }
  }

  // `Number('')` is 0, and 0 is a *valid* VAT rate — so an unanswered VAT field would
  // silently zero-rate the item, and the mistake would first surface on an invoice.
  // Emptiness has to be rejected before the number is looked at.
  const vatRate = form.vatRate?.trim() ? Number(form.vatRate) : Number.NaN
  if (!VAT_RATES.includes(vatRate as VatRate)) problems.push({ field: 'vatRate', code: 'invalid' })

  const driver = form.quantityDriver as QuantityDriver
  if (!DRIVERS.includes(driver)) problems.push({ field: 'quantityDriver', code: 'invalid' })

  if (problems.length > 0) return { ok: false, problems }

  return {
    ok: true,
    value: {
      name,
      description,
      unit,
      unitPriceCents: unitPrice as number,
      floorPriceCents: (floorPrice ?? unitPrice) as number,
      vatRate: vatRate as VatRate,
      quantityDriver: driver,
    },
  }
}

/**
 * What each quantity driver means, in the owner's language.
 *
 * "quantity_driver" is our word. Hers is "wonach rechnen Sie ab?" — and the unit she
 * picks here is what multiplies her price in the engine, so getting it wrong is a
 * wrong quote rather than a cosmetic slip.
 */
export function driverLabel(driver: QuantityDriver, language: 'de' | 'en' = 'de'): string {
  const de: Record<QuantityDriver, string> = {
    flat: 'Pauschal — ein Preis, unabhängig von der Größe',
    per_guest: 'Pro Person',
    per_hour: 'Pro Stunde',
    per_km: 'Pro Kilometer',
    per_day: 'Pro Tag',
    per_item: 'Pro Stück',
  }
  const en: Record<QuantityDriver, string> = {
    flat: 'Flat — one price, whatever the size',
    per_guest: 'Per person',
    per_hour: 'Per hour',
    per_km: 'Per kilometre',
    per_day: 'Per day',
    per_item: 'Per item',
  }
  return language === 'de' ? de[driver] : en[driver]
}

/**
 * The unit that goes on the quote line, given a driver.
 *
 * Prefilled so the owner does not have to invent it, and overridable because hers may
 * be better — "Gedeck" rather than "Personen" is what her customers expect to read.
 */
export function defaultUnit(driver: QuantityDriver): string {
  const units: Record<QuantityDriver, string> = {
    flat: 'Pauschale',
    per_guest: 'Personen',
    per_hour: 'Stunden',
    per_km: 'km',
    per_day: 'Tage',
    per_item: 'Stück',
  }
  return units[driver]
}

export { DRIVERS as QUANTITY_DRIVERS, VAT_RATES }
