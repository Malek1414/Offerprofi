/**
 * The deterministic pricing engine (PRODUCT_SPEC §7, decision D6).
 *
 * Pure. Same input, same output, no I/O, no model call, no clock, no randomness.
 * That is not fastidiousness — it is what lets a quote be defended. Every run emits
 * a full `CalculationTrace`, so any figure on any document can be reconstructed
 * years later and explained to a customer, an owner, or a tax auditor in plain
 * language. A model-priced system cannot offer that at any price.
 *
 * The conversation model's only role in pricing is upstream: mapping a customer's
 * words onto catalogue ids (spec §7.3 step 1). From there down, everything is code.
 *
 * Calculation order is fixed and testable (spec §7.3):
 *   1. resolve service selection   → items and packages
 *   2. resolve quantities          → from the event attributes
 *   3. apply price rules           → tiered unit prices
 *   4. line subtotals              = quantity × resolved unit price
 *   5. apply modifiers             → ordered, each recorded individually
 *   6. sum                         → net
 *   7. VAT per line                → 19 / 7 / 0
 *   8. gross total
 *   9. guardrail check             → runs separately, see ../guardrails
 */

import {
  type Catalogue,
  type CatalogItem,
  type CatalogItemId,
  type Modifier,
  type PriceRule,
  type QuantityDriver,
  type VatRate,
  resolveUnitPrice,
} from '../domain/catalogue'
import { type Cents, ZERO, add, cents, multiplyByQuantity, percentOf } from '../domain/money'
import type { AvailabilityOutcome, PricingInput } from '../domain/pricing-input'

export interface QuoteLine {
  catalogItemId: CatalogItemId
  name: string
  description: string
  unit: string
  quantity: number
  quantityDriver: QuantityDriver
  listUnitPrice: Cents
  /** After tiered price rules. Never below `floorPrice` — asserted, not hoped. */
  unitPrice: Cents
  floorPrice: Cents
  /** quantity × unitPrice, before modifiers. */
  subtotal: Cents
  /** Sum of modifier deltas attributed to this line. */
  modifierTotal: Cents
  /** subtotal + modifierTotal. */
  net: Cents
  vatRate: VatRate
  vat: Cents
  gross: Cents
  fromPackageId?: string
}

export interface AppliedModifier {
  modifierId: string
  kind: string
  adjustmentType: 'pct' | 'fixed'
  value: number
  /** The cents this modifier added (or removed). */
  delta: Cents
  appliedToLine: CatalogItemId | null
  orderIndex: number
  reason: string
}

export interface VatBreakdownEntry {
  rate: VatRate
  net: Cents
  vat: Cents
}

/** Every decision the engine made, in order. Stored on the quote version verbatim. */
export interface CalculationTrace {
  engineVersion: string
  steps: TraceStep[]
  input: PricingInput
}

export type TraceStep =
  | { step: 1; action: 'resolve_services'; resolved: string[]; unknown: string[] }
  | { step: 2; action: 'resolve_quantity'; item: string; driver: QuantityDriver; quantity: number }
  | { step: 3; action: 'apply_price_rule'; item: string; rule: PriceRule | null; unitPrice: number }
  | { step: 4; action: 'line_subtotal'; item: string; quantity: number; unitPrice: number; subtotal: number }
  | { step: 5; action: 'apply_modifier'; modifier: AppliedModifier }
  | { step: 6; action: 'sum_net'; net: number }
  | { step: 7; action: 'vat'; rate: VatRate; net: number; vat: number }
  | { step: 8; action: 'gross_total'; gross: number }

export interface PricedQuote {
  lines: QuoteLine[]
  modifiers: AppliedModifier[]
  netTotal: Cents
  vatBreakdown: VatBreakdownEntry[]
  grossTotal: Cents
  trace: CalculationTrace
  /** Ids the model asked for that are not in the catalogue. Never invented (D8). */
  unknownServiceIds: string[]
  availability: AvailabilityOutcome
}

export const ENGINE_VERSION = '2026-08-08.1'

/**
 * Derive a line's quantity from the event attributes.
 *
 * `per_km` uses distance directly rather than doubling it for a return trip — whether
 * travel is charged one way or both is an agency's own pricing decision, expressed in
 * their per-km rate, not something we should assume on their behalf.
 */
function resolveQuantity(driver: QuantityDriver, input: PricingInput): number {
  switch (driver) {
    case 'flat':
      return 1
    case 'per_guest':
      return input.guestCount
    case 'per_hour':
      return input.durationHours
    case 'per_km':
      return input.distanceKm
    case 'per_day':
      return Math.max(1, Math.ceil(input.durationHours / 24))
    case 'per_item':
      return 1
  }
}

function isWeekend(isoDate: string): boolean {
  if (!isoDate) return false
  const d = new Date(`${isoDate}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return false
  const day = d.getUTCDay()
  return day === 0 || day === 6
}

function withinRanges(isoDate: string, ranges: { startsOn: string; endsOn: string }[]): boolean {
  if (!isoDate) return false
  // Compared as MM-DD so a seasonal range works every year without re-entry.
  const md = isoDate.slice(5, 10)
  return ranges.some(({ startsOn, endsOn }) => {
    const a = startsOn.slice(5, 10)
    const b = endsOn.slice(5, 10)
    // A range that wraps the new year (e.g. Nov–Feb) is still one range.
    return a <= b ? md >= a && md <= b : md >= a || md <= b
  })
}

function modifierApplies(mod: Modifier, input: PricingInput): { applies: boolean; reason: string } {
  const c = mod.condition
  switch (c.kind) {
    case 'weekend':
      return isWeekend(input.eventDate)
        ? { applies: true, reason: `${input.eventDate} falls on a weekend` }
        : { applies: false, reason: '' }
    case 'peak_season':
      return withinRanges(input.eventDate, c.ranges)
        ? { applies: true, reason: `${input.eventDate} falls in peak season` }
        : { applies: false, reason: '' }
    case 'rush':
      return input.availability === 'below_lead_time'
        ? { applies: true, reason: `booked inside the ${c.leadTimeMinDays}-day minimum lead time` }
        : { applies: false, reason: '' }
    case 'travel_distance':
      return input.distanceKm > c.thresholdKm
        ? { applies: true, reason: `${input.distanceKm} km exceeds the ${c.thresholdKm} km threshold` }
        : { applies: false, reason: '' }
    case 'overtime':
      return input.durationHours > c.includedHours
        ? {
            applies: true,
            reason: `${input.durationHours} h exceeds the ${c.includedHours} h included`,
          }
        : { applies: false, reason: '' }
  }
}

/**
 * Price an event against a catalogue.
 *
 * Throws only on programmer error (an item id present in the catalogue map but
 * malformed). An unknown service id is data, not an error: it is collected into
 * `unknownServiceIds` so the caller can escalate to the owner. Inventing a line to
 * cover it would violate D8, and dropping it silently would quote the customer for
 * less than they asked for.
 */
export function priceQuote(input: PricingInput, catalogue: Catalogue): PricedQuote {
  const steps: TraceStep[] = []
  const lines: QuoteLine[] = []
  const appliedModifiers: AppliedModifier[] = []
  const unknownServiceIds: string[] = []

  // ── Step 1: resolve service selection ─────────────────────────────────────
  const requested: { item: CatalogItem; fromPackageId?: string; packageQuantity?: number }[] = []

  for (const pkgId of input.packageIds) {
    const pkg = catalogue.packages.get(pkgId)
    if (!pkg) {
      unknownServiceIds.push(pkgId)
      continue
    }
    for (const member of pkg.items) {
      const item = catalogue.items.get(member.catalogItemId)
      if (!item || !item.active) {
        unknownServiceIds.push(member.catalogItemId)
        continue
      }
      requested.push({ item, fromPackageId: pkg.id, packageQuantity: member.quantity })
    }
  }

  for (const id of input.serviceIds) {
    const item = catalogue.items.get(id)
    if (!item || !item.active) {
      unknownServiceIds.push(id)
      continue
    }
    // A service already pulled in by a package is not charged twice.
    if (requested.some((r) => r.item.id === id)) continue
    requested.push({ item })
  }

  steps.push({
    step: 1,
    action: 'resolve_services',
    resolved: requested.map((r) => r.item.id),
    unknown: unknownServiceIds,
  })

  // ── Steps 2–4: quantities, price rules, line subtotals ────────────────────
  for (const { item, fromPackageId, packageQuantity } of requested) {
    const quantity = packageQuantity ?? resolveQuantity(item.quantityDriver, input)
    steps.push({
      step: 2,
      action: 'resolve_quantity',
      item: item.id,
      driver: item.quantityDriver,
      quantity,
    })

    const { unitPrice: tiered, ruleApplied } = resolveUnitPrice(item, quantity, catalogue.priceRules)

    // The floor is absolute (D8). A tiered rule that dips below it is a catalogue
    // configuration error, and we resolve it in the customer's favour by refusing to
    // go below the floor rather than by silently honouring the cheaper band.
    const unitPrice = tiered < item.floorPrice ? item.floorPrice : tiered

    steps.push({
      step: 3,
      action: 'apply_price_rule',
      item: item.id,
      rule: ruleApplied,
      unitPrice,
    })

    const subtotal = multiplyByQuantity(unitPrice, quantity)
    steps.push({
      step: 4,
      action: 'line_subtotal',
      item: item.id,
      quantity,
      unitPrice,
      subtotal,
    })

    lines.push({
      catalogItemId: item.id,
      name: item.name,
      description: item.description,
      unit: item.unit,
      quantity,
      quantityDriver: item.quantityDriver,
      listUnitPrice: item.unitPrice,
      unitPrice,
      floorPrice: item.floorPrice,
      subtotal,
      modifierTotal: ZERO,
      net: subtotal,
      vatRate: input.reverseCharge ? 0 : item.vatRate,
      vat: ZERO,
      gross: ZERO,
      ...(fromPackageId ? { fromPackageId } : {}),
    })
  }

  // ── Step 5: modifiers, in order, each recorded ────────────────────────────
  for (const mod of catalogue.modifiers) {
    const { applies, reason } = modifierApplies(mod, input)
    if (!applies) continue

    if (mod.adjustmentType === 'pct') {
      // A percentage modifier applies per line, so the trace shows exactly which
      // part of the quote it moved rather than a single unattributed lump.
      for (const line of lines) {
        const delta = percentOf(line.subtotal, mod.value)
        if (delta === 0) continue
        line.modifierTotal = add(line.modifierTotal, delta)
        const record: AppliedModifier = {
          modifierId: mod.id,
          kind: mod.kind,
          adjustmentType: 'pct',
          value: mod.value,
          delta,
          appliedToLine: line.catalogItemId,
          orderIndex: mod.orderIndex,
          reason,
        }
        appliedModifiers.push(record)
        steps.push({ step: 5, action: 'apply_modifier', modifier: record })
      }
    } else {
      // A fixed modifier is a whole-quote surcharge (travel, rush fee). It attaches
      // to the first line so VAT has a rate to apply, and the trace says so.
      const target = lines[0]
      if (!target) continue
      const delta = cents(mod.value)
      target.modifierTotal = add(target.modifierTotal, delta)
      const record: AppliedModifier = {
        modifierId: mod.id,
        kind: mod.kind,
        adjustmentType: 'fixed',
        value: mod.value,
        delta,
        appliedToLine: target.catalogItemId,
        orderIndex: mod.orderIndex,
        reason,
      }
      appliedModifiers.push(record)
      steps.push({ step: 5, action: 'apply_modifier', modifier: record })
    }
  }

  // ── Steps 6–8: net, VAT per line, gross ───────────────────────────────────
  for (const line of lines) {
    line.net = add(line.subtotal, line.modifierTotal)
  }

  const netTotal = add(...lines.map((l) => l.net))
  steps.push({ step: 6, action: 'sum_net', net: netTotal })

  const byRate = new Map<VatRate, { net: Cents; vat: Cents }>()
  for (const line of lines) {
    line.vat = percentOf(line.net, line.vatRate)
    line.gross = add(line.net, line.vat)
    const bucket = byRate.get(line.vatRate) ?? { net: ZERO, vat: ZERO }
    byRate.set(line.vatRate, {
      net: add(bucket.net, line.net),
      vat: add(bucket.vat, line.vat),
    })
  }

  const vatBreakdown: VatBreakdownEntry[] = [...byRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, v]) => {
      steps.push({ step: 7, action: 'vat', rate, net: v.net, vat: v.vat })
      return { rate, net: v.net, vat: v.vat }
    })

  const grossTotal = add(netTotal, add(...vatBreakdown.map((v) => v.vat)))
  steps.push({ step: 8, action: 'gross_total', gross: grossTotal })

  return {
    lines,
    modifiers: appliedModifiers,
    netTotal,
    vatBreakdown,
    grossTotal,
    trace: { engineVersion: ENGINE_VERSION, steps, input },
    unknownServiceIds,
    availability: input.availability,
  }
}

/**
 * Produce a reduced-scope variant that fits a budget (spec §7.4).
 *
 * Removes whole catalogue lines, cheapest-value-first, until the gross total fits.
 * It never discounts and it never returns "no" — if nothing fits, the caller gets
 * back the smallest possible variant and escalates to the owner. Telling a customer
 * they cannot be served is not an outcome this system has (I1).
 */
export function reduceScopeToBudget(
  input: PricingInput,
  catalogue: Catalogue,
  budgetCents: Cents,
): { variant: PricedQuote; removed: CatalogItemId[]; fits: boolean } {
  const full = priceQuote(input, catalogue)
  if (full.grossTotal <= budgetCents) {
    return { variant: full, removed: [], fits: true }
  }

  // Drop the cheapest lines first. Dropping the most expensive would reach the
  // budget faster, but it strips out the service the customer is actually buying and
  // leaves behind the ancillaries — a "quote" consisting of a travel surcharge and a
  // DJ is not an offer anyone would send. Removing the small extras first keeps the
  // substantive service intact for as long as possible, so whatever survives is
  // still something the owner would put their name to.
  //
  // Known limitation: this removes whole lines only. It will not reduce a guest count
  // or move a line into a cheaper tier, so a budget that sits between two line
  // combinations lands lower than it strictly needs to. The owner sees the variant
  // before it goes anywhere, and under-quoting scope is safer than over-promising it.
  const droppable = [...full.lines]
    .filter((l) => !l.fromPackageId) // packages are sold whole
    .sort((a, b) => a.gross - b.gross)

  const removed: CatalogItemId[] = []
  let keep = new Set(input.serviceIds)

  for (let i = 0; i < droppable.length; i++) {
    const candidate = droppable[i]
    if (!candidate) continue
    const trial = new Set(keep)
    trial.delete(candidate.catalogItemId)
    if (trial.size === 0) break // never propose an empty quote

    const trialQuote = priceQuote({ ...input, serviceIds: [...trial] }, catalogue)
    keep = trial
    removed.push(candidate.catalogItemId)
    if (trialQuote.grossTotal <= budgetCents) {
      return { variant: trialQuote, removed, fits: true }
    }
  }

  const variant = priceQuote({ ...input, serviceIds: [...keep] }, catalogue)
  return { variant, removed, fits: variant.grossTotal <= budgetCents }
}
