/**
 * What the caterer keeps (Phase B2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS WRAPS THE ENGINE. IT DOES NOT EXTEND IT.
 *
 * `priceQuote` is golden-set tested to the cent and `ENGINE_VERSION` is stamped
 * on every stored trace. Adding cost arithmetic inside it would put a margin bug
 * one edit away from being a pricing bug, and would invalidate the golden set for
 * a number that never appears on a customer's document.
 *
 * So this takes a finished `PricedQuote` and reads it. It cannot change a price,
 * because it has no way to produce one — every figure it returns is derived from
 * lines the engine already computed.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A MISSING COST IS "UNKNOWN", NEVER "ZERO".
 *
 * `cost_cents` is nullable because filling it in is the most tedious step of
 * onboarding and no caterer should be blocked behind it. Treating an absent cost
 * as zero would report every un-costed line as pure profit — a number that is
 * always wrong in the flattering direction, on the screen where he decides
 * whether an event is worth doing. Unknown lines are counted separately and named.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Margin is computed on **net**, not gross. VAT is collected on the state's behalf
 * and passed straight through; counting it as revenue would inflate every margin
 * by the VAT rate.
 */

import type { CatalogItemId } from '../domain/catalogue'
import { type Cents, ZERO, add, cents, multiplyByQuantity, subtract } from '../domain/money'
import type { PricedQuote, QuoteLine } from './pricing'

export interface MarginLine {
  catalogItemId: CatalogItemId
  name: string
  quantity: number
  /** The line's net, straight from the engine. Never recomputed here. */
  revenue: Cents
  /** quantity × unit cost. Null when this service has no cost recorded. */
  cost: Cents | null
  /** revenue − cost. Null when the cost is unknown. */
  margin: Cents | null
  /** 0–100, rounded to one decimal. Null when the cost is unknown. */
  marginPct: number | null
}

export interface MarginSummary {
  lines: MarginLine[]
  /** Net revenue across every line — equals the engine's net total, by construction. */
  revenue: Cents
  /** Cost of the lines that have one. Lines without are excluded, not zeroed. */
  knownCost: Cents
  /** revenue of costed lines − knownCost. The honest figure. */
  margin: Cents
  /** Margin as a percentage of the *costed* revenue, not of everything. */
  marginPct: number | null
  /**
   * Services with no cost recorded. Named rather than counted, because the fix is
   * one number per service and he needs to know which.
   */
  unknownCostLines: { catalogItemId: CatalogItemId; name: string }[]
  /** Revenue sitting on those lines. How much of the total the margin says nothing about. */
  uncostedRevenue: Cents
  /** True when at least one line has a cost. False means there is nothing to show. */
  hasAnyCost: boolean
}

/** Unit cost per catalogue item, in cents. Absent means unknown. */
export type CostTable = ReadonlyMap<CatalogItemId, Cents>

export function summariseMargin(quote: PricedQuote, costs: CostTable): MarginSummary {
  const lines = quote.lines.map((line) => marginForLine(line, costs))

  let revenue = ZERO
  let knownCost = ZERO
  let costedRevenue = ZERO
  const unknownCostLines: { catalogItemId: CatalogItemId; name: string }[] = []
  let uncostedRevenue = ZERO

  for (const line of lines) {
    revenue = add(revenue, line.revenue)
    if (line.cost === null) {
      unknownCostLines.push({ catalogItemId: line.catalogItemId, name: line.name })
      uncostedRevenue = add(uncostedRevenue, line.revenue)
      continue
    }
    knownCost = add(knownCost, line.cost)
    costedRevenue = add(costedRevenue, line.revenue)
  }

  const margin = subtract(costedRevenue, knownCost)

  return {
    lines,
    revenue,
    knownCost,
    margin,
    marginPct: percentage(margin, costedRevenue),
    unknownCostLines,
    uncostedRevenue,
    hasAnyCost: lines.some((l) => l.cost !== null),
  }
}

function marginForLine(line: QuoteLine, costs: CostTable): MarginLine {
  const unitCost = costs.get(line.catalogItemId)
  const base = {
    catalogItemId: line.catalogItemId,
    name: line.name,
    quantity: line.quantity,
    // The engine's own figure. Modifiers are already in it, which is right: a
    // weekend surcharge is revenue he keeps.
    revenue: line.net,
  }

  if (unitCost === undefined) {
    return { ...base, cost: null, margin: null, marginPct: null }
  }

  const cost = multiplyByQuantity(unitCost, line.quantity)
  const margin = subtract(line.net, cost)
  return { ...base, cost, margin, marginPct: percentage(margin, line.net) }
}

/**
 * Margin over revenue, as a percentage.
 *
 * Null on zero revenue rather than zero or infinity: a free line has no margin
 * percentage, and printing "0%" next to it would read as a loss.
 */
function percentage(margin: Cents, revenue: Cents): number | null {
  if (revenue === ZERO) return null
  return Math.round((Number(margin) / Number(revenue)) * 1000) / 10
}

/** Build a cost table from catalogue rows. Rows with no cost are simply absent. */
export function costTable(
  items: readonly { id: CatalogItemId; costCents: number | null }[],
): CostTable {
  const table = new Map<CatalogItemId, Cents>()
  for (const item of items) {
    if (item.costCents === null || item.costCents === undefined) continue
    table.set(item.id, cents(item.costCents))
  }
  return table
}
