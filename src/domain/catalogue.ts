/**
 * The agency's catalogue (PRODUCT_SPEC §7.1).
 *
 * This is the only source of prices in the product. The conversation model maps a
 * customer's intent onto ids in here (spec §7.3 step 1) and does nothing else with
 * money — every arithmetic operation downstream is code. That split is what makes
 * D6 real: any figure on any document can be reconstructed and defended.
 *
 * Nothing enters this catalogue unconfirmed. Onboarding extraction produces
 * candidates; the owner confirms, edits or rejects each one (F2.8).
 */

import type { Cents } from './money'

export type CatalogItemId = string & { readonly __brand: 'CatalogItemId' }
export type PackageId = string & { readonly __brand: 'PackageId' }
export type ModifierId = string & { readonly __brand: 'ModifierId' }

export function catalogItemId(id: string): CatalogItemId {
  return id as CatalogItemId
}
export function packageId(id: string): PackageId {
  return id as PackageId
}

/**
 * How a line's quantity is derived from the EventBrief.
 *
 * `flat` means quantity 1 regardless of the event — a fixed fee. `per_item` means the
 * customer chose a count explicitly rather than it being implied by guests or hours.
 */
export type QuantityDriver =
  | 'flat'
  | 'per_guest'
  | 'per_hour'
  | 'per_km'
  | 'per_day'
  | 'per_item'

/** German VAT rates. 0 is reverse charge for EU B2B with a validated VAT id. */
export type VatRate = 19 | 7 | 0

export interface CatalogItem {
  id: CatalogItemId
  agencyId: string
  name: string
  description: string
  unit: string
  unitPrice: Cents
  /**
   * The hard floor (D8). The agent may never quote below this, for any reason —
   * not to win a deal, not to match a competitor, not because the customer asked
   * nicely. Defaults to the list price, so "no discounting" is the out-of-the-box
   * behaviour and discounting is something an owner has to deliberately enable.
   */
  floorPrice: Cents
  vatRate: VatRate
  quantityDriver: QuantityDriver
  active: boolean
}

/** Tiered (Staffel) pricing: a quantity band overrides the item's unit price. */
export interface PriceRule {
  catalogItemId: CatalogItemId
  minQty: number
  /** Inclusive upper bound. `null` means open-ended. */
  maxQty: number | null
  unitPrice: Cents
}

export interface Package {
  id: PackageId
  agencyId: string
  name: string
  description: string
  /** When set, replaces the sum of the package's items. */
  bundlePrice: Cents | null
  items: { catalogItemId: CatalogItemId; quantity: number }[]
}

export type ModifierKind =
  | 'weekend'
  | 'peak_season'
  | 'rush'
  | 'travel_distance'
  | 'overtime'

export type ModifierCondition =
  | { kind: 'weekend' }
  | { kind: 'peak_season'; ranges: { startsOn: string; endsOn: string }[] }
  | { kind: 'rush'; leadTimeMinDays: number }
  | { kind: 'travel_distance'; thresholdKm: number }
  | { kind: 'overtime'; includedHours: number }

export interface Modifier {
  id: ModifierId
  agencyId: string
  kind: ModifierKind
  condition: ModifierCondition
  adjustmentType: 'pct' | 'fixed'
  /** Percent (e.g. 15 for +15%) or cents, per `adjustmentType`. */
  value: number
  /** Applied in ascending order. Order is recorded in the trace so it can be audited. */
  orderIndex: number
}

/** Everything the pricing engine may read. Note the absence of anything about a person. */
export interface Catalogue {
  items: Map<CatalogItemId, CatalogItem>
  priceRules: PriceRule[]
  packages: Map<PackageId, Package>
  modifiers: Modifier[]
}

export function buildCatalogue(input: {
  items: CatalogItem[]
  priceRules?: PriceRule[]
  packages?: Package[]
  modifiers?: Modifier[]
}): Catalogue {
  return {
    items: new Map(input.items.map((i) => [i.id, i])),
    priceRules: input.priceRules ?? [],
    packages: new Map((input.packages ?? []).map((p) => [p.id, p])),
    modifiers: [...(input.modifiers ?? [])].sort((a, b) => a.orderIndex - b.orderIndex),
  }
}

/**
 * Resolve the unit price for a quantity, applying tiered rules.
 *
 * The most specific matching band wins; where bands overlap (which the catalogue UI
 * discourages but does not forbid) the narrowest one is used, so an agency adding a
 * special case for "exactly 100 guests" gets the behaviour they expect.
 */
export function resolveUnitPrice(
  item: CatalogItem,
  quantity: number,
  rules: readonly PriceRule[],
): { unitPrice: Cents; ruleApplied: PriceRule | null } {
  const matching = rules.filter(
    (r) =>
      r.catalogItemId === item.id &&
      quantity >= r.minQty &&
      (r.maxQty === null || quantity <= r.maxQty),
  )
  if (matching.length === 0) return { unitPrice: item.unitPrice, ruleApplied: null }

  const width = (r: PriceRule) => (r.maxQty === null ? Number.POSITIVE_INFINITY : r.maxQty - r.minQty)
  const best = matching.reduce((a, b) => {
    const wa = width(a)
    const wb = width(b)
    if (wb !== wa) return wb < wa ? b : a
    // Equal width — which happens whenever two bands are both open-ended. Falling
    // back to array order here would make the price depend on row insertion order,
    // and a "deterministic engine" whose output moves when you re-sort a table is
    // not one. The higher floor is the more specific band, so it wins.
    return b.minQty > a.minQty ? b : a
  })
  return { unitPrice: best.unitPrice, ruleApplied: best }
}
