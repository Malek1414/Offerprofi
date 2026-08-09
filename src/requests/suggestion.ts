/**
 * "Here is what I'd charge, and here is what you keep" (Phase B2).
 *
 * The engine, unchanged, rendered to the caterer instead of to his customer. Same
 * arithmetic, same trace, opposite side of the handoff — which is the whole of N1
 * in one module.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A SUGGESTION IS NEVER A FAILURE.
 *
 * An empty catalogue, an unmapped request, a model that timed out: every one of
 * them produces a request page with no price block and a line saying why, not an
 * error. He came to read an enquiry. The suggestion is the extra.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Nothing here is stored. The suggestion is recomputed on each view because the
 * catalogue underneath it may have changed, and a cached price from last week
 * shown as today's suggestion is the one way this feature could mislead him.
 */

import { asAnonymous } from '../db/client'
import {
  type CatalogItem,
  type Catalogue,
  type Modifier,
  type ModifierCondition,
  type ModifierId,
  type PriceRule,
  type QuantityDriver,
  type VatRate,
  buildCatalogue,
  catalogItemId,
} from '../domain/catalogue'
import type { CateringRequest } from '../domain/catering-request'
import { cents } from '../domain/money'
import type { AvailabilityOutcome } from '../domain/pricing-input'
import { requestToPricingInput } from '../domain/request-pricing-input'
import { type MarginSummary, costTable, summariseMargin } from '../engine/margin'
import { type PricedQuote, priceQuote } from '../engine/pricing'
import { hasDatabase } from '../lib/demo'
import { type MappableItem, mapServices } from '../agent/service-mapping'

export interface PriceSuggestion {
  quote: PricedQuote
  margin: MarginSummary
  /** One sentence from the mapper, for him. */
  rationale: string
  /** What she asked for that nothing in the catalogue answers. */
  unmatched: string[]
}

export type SuggestionOutcome =
  | { ok: true; suggestion: PriceSuggestion }
  /**
   * Why there is no suggestion, as a code the renderer localises. Never a raw
   * error string: this appears on a page a caterer reads.
   */
  | { ok: false; reason: 'no_catalogue' | 'no_match' | 'unavailable' }

interface CatalogueRow extends MappableItem {
  costCents: number | null
  item: CatalogItem
  priceRules: PriceRule[]
}

/**
 * Build the suggestion for one request.
 *
 * `availability` is `'available'` until calendar sync exists (F4.9–F4.12). That is
 * the same default the rest of the product uses, and it is honest here in a way it
 * would not be on a customer's quote: the caterer knows his own diary, and the
 * suggestion is not a promise about the date.
 */
export async function suggestPrice(
  agencyId: string,
  request: CateringRequest,
  inquiryId: string | null,
  availability: AvailabilityOutcome = 'available',
): Promise<SuggestionOutcome> {
  if (!hasDatabase()) return { ok: false, reason: 'unavailable' }

  const rows = await loadCatalogue(agencyId).catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: 'suggestion_catalogue_read_failed',
        agencyId,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    return null
  })

  if (rows === null) return { ok: false, reason: 'unavailable' }
  if (rows.length === 0) return { ok: false, reason: 'no_catalogue' }

  const mapping = await mapServices({
    agencyId,
    inquiryId,
    request,
    catalogue: rows.map(({ id, name, description, unit }) => ({ id, name, description, unit })),
  })

  if (!mapping.ok) {
    // Including a model failure. He reads the enquiry either way, and "no
    // suggestion this time" is a smaller problem than a wrong one.
    return { ok: false, reason: mapping.failure === 'empty_catalogue' ? 'no_catalogue' : 'no_match' }
  }
  if (mapping.serviceIds.length === 0) return { ok: false, reason: 'no_match' }

  const modifiers = await loadModifiers(agencyId).catch(() => [])

  const catalogue: Catalogue = buildCatalogue({
    items: rows.map((r) => r.item),
    priceRules: rows.flatMap((r) => r.priceRules),
    modifiers,
  })

  // The engine, called exactly as it has always been called. No second pricing
  // path exists and none is wanted (D6).
  const quote = priceQuote(
    requestToPricingInput(request, mapping.serviceIds, availability),
    catalogue,
  )

  const margin = summariseMargin(quote, costTable(rows))

  return {
    ok: true,
    suggestion: {
      quote,
      margin,
      rationale: mapping.rationale,
      unmatched: mapping.unmatched,
    },
  }
}

async function loadCatalogue(agencyId: string): Promise<CatalogueRow[]> {
  return asAnonymous(async (client) => {
    const result = await client.query(
      `select id, name, description, unit, unit_price_cents, floor_price_cents,
              cost_cents, vat_rate, quantity_driver, price_rules
         from public.catalogue_for_pricing($1::uuid)`,
      [agencyId],
    )

    return result.rows.map((row): CatalogueRow => {
      const id = catalogItemId(String(row.id))
      return {
        id,
        name: String(row.name),
        description: String(row.description ?? ''),
        unit: String(row.unit),
        costCents: row.cost_cents === null ? null : Number(row.cost_cents),
        item: {
          id,
          agencyId,
          name: String(row.name),
          description: String(row.description ?? ''),
          unit: String(row.unit),
          unitPrice: cents(Number(row.unit_price_cents)),
          floorPrice: cents(Number(row.floor_price_cents)),
          vatRate: Number(row.vat_rate) as VatRate,
          quantityDriver: String(row.quantity_driver) as QuantityDriver,
          active: true,
        },
        priceRules: parsePriceRules(row.price_rules, id),
      }
    })
  })
}

function parsePriceRules(value: unknown, item: ReturnType<typeof catalogItemId>): PriceRule[] {
  if (!Array.isArray(value)) return []
  const rules: PriceRule[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const r = entry as { min_qty?: unknown; max_qty?: unknown; unit_price_cents?: unknown }
    if (typeof r.min_qty !== 'number' || typeof r.unit_price_cents !== 'number') continue
    rules.push({
      catalogItemId: item,
      minQty: r.min_qty,
      maxQty: typeof r.max_qty === 'number' ? r.max_qty : null,
      unitPrice: cents(r.unit_price_cents),
    })
  }
  return rules
}

/**
 * Modifiers, best-effort.
 *
 * A malformed condition is skipped rather than thrown: a broken weekend surcharge
 * should cost him a surcharge on one suggestion, not the whole suggestion.
 */
async function loadModifiers(agencyId: string): Promise<Modifier[]> {
  return asAnonymous(async (client) => {
    const result = await client.query(
      `select id, kind, condition_json, adjustment_type, value, order_index
         from public.modifiers_for_pricing($1::uuid)`,
      [agencyId],
    )

    const modifiers: Modifier[] = []
    for (const row of result.rows) {
      const condition = row.condition_json as ModifierCondition | null
      if (!condition || typeof condition !== 'object' || !('kind' in condition)) continue
      modifiers.push({
        id: String(row.id) as ModifierId,
        agencyId,
        kind: condition.kind,
        condition,
        adjustmentType: row.adjustment_type === 'fixed' ? 'fixed' : 'pct',
        value: Number(row.value),
        orderIndex: Number(row.order_index),
      })
    }
    return modifiers
  })
}
