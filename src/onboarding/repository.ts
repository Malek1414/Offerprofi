/**
 * Reading and writing onboarding state (F2.9, F2.12).
 *
 * Every query here runs through `withUser`, so RLS resolves the tenant from
 * `app.current_user_id` and no statement below mentions `agency_id` in a WHERE clause
 * for security purposes. That is the arrangement src/db/client.ts exists to make
 * possible: a forgotten tenant filter stops being a cross-tenant leak.
 *
 * Where `agency_id` does appear it is in an INSERT, because a row has to be given a
 * tenant — and the RLS WITH CHECK clause verifies that the value is one the user is
 * actually a member of, so a tampered id is rejected by the database rather than
 * trusted by us.
 */

import type { PoolClient } from 'pg'

import { withUser } from '../db/client'
import { cents, type Cents } from '../domain/money'
import type { OnboardingState } from './progress'

export interface AgencyContext {
  agencyId: string
  agencyName: string
  slug: string | null
  role: 'owner' | 'member'
  ownerDisplayName: string | null
}

/**
 * The agency this user works for.
 *
 * Returns the first, ordered by creation. Multi-agency membership is possible in the
 * schema (a freelancer working for two agencies) but has no UI yet; picking the
 * oldest deterministically is better than picking an arbitrary row, and when the
 * switcher is built this becomes the default rather than the only option.
 */
export async function currentAgency(userId: string): Promise<AgencyContext | null> {
  return withUser(userId, async (client) => {
    const result = await client.query<{
      agency_id: string
      name: string
      role: 'owner' | 'member'
      slug: string | null
      owner_display_name: string | null
    }>(
      `select m.agency_id, a.name, m.role, s.slug, a.owner_display_name
         from agency_members m
         join agencies a on a.id = m.agency_id
         left join agency_slugs s on s.agency_id = m.agency_id
        where m.user_id = public.current_user_id()
        order by a.created_at
        limit 1`,
    )

    const row = result.rows[0]
    if (!row) return null
    return {
      agencyId: row.agency_id,
      agencyName: row.name,
      slug: row.slug,
      role: row.role,
      ownerDisplayName: row.owner_display_name,
    }
  })
}

/**
 * The five counts the progress meter is computed from.
 *
 * One round trip rather than five, because this runs on every render of the
 * onboarding shell and the owner is on a phone. The subqueries are all against
 * RLS-filtered tables, so each of them sees exactly one tenant.
 */
export async function onboardingState(userId: string): Promise<OnboardingState> {
  return withUser(userId, async (client) => {
    const result = await client.query<{
      past_quotes: string
      confirmed_items: string
      items_with_price: string
      brand_confirmed: boolean
      guardrails_set: boolean
    }>(
      `select
         (select count(*) from onboarding_assets where kind = 'past_quote')          as past_quotes,
         (select count(*) from catalog_items where confirmed_at is not null)         as confirmed_items,
         (select count(*) from catalog_items i
            where i.confirmed_at is not null
              and (i.unit_price_cents > 0
                   or exists (select 1 from price_rules r where r.catalog_item_id = i.id)))
                                                                                      as items_with_price,
         (select exists (select 1 from brand_profiles where confirmed_at is not null)) as brand_confirmed,
         (select exists (select 1 from guardrails))                                    as guardrails_set`,
    )

    const row = result.rows[0]
    return {
      pastQuotesUploaded: Number(row?.past_quotes ?? 0),
      confirmedItemCount: Number(row?.confirmed_items ?? 0),
      itemsWithPriceRule: Number(row?.items_with_price ?? 0),
      brandConfirmed: Boolean(row?.brand_confirmed),
      guardrailsSet: Boolean(row?.guardrails_set),
    }
  })
}

export interface CatalogueItemRow {
  id: string
  name: string
  description: string
  unit: string
  unitPrice: Cents
  floorPrice: Cents
  vatRate: 19 | 7 | 0
  quantityDriver: 'flat' | 'per_guest' | 'per_hour' | 'per_km' | 'per_unit'
  active: boolean
  confirmedAt: string | null
  priceRuleCount: number
}

export async function listCatalogueItems(userId: string): Promise<CatalogueItemRow[]> {
  return withUser(userId, async (client) => {
    const result = await client.query(
      `select i.*, (select count(*) from price_rules r where r.catalog_item_id = i.id) as rule_count
         from catalog_items i
        order by i.confirmed_at is null desc, i.name`,
    )
    return result.rows.map(toCatalogueItem)
  })
}

export interface CatalogueItemInput {
  name: string
  description: string
  unit: string
  unitPriceCents: number
  floorPriceCents: number
  vatRate: number
  quantityDriver: string
}

/**
 * Create an item by hand (F2.9, F2.11).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This is the *manual* path, and it is the one place where an item may be created
 * already confirmed — because the owner typed it herself, which is exactly what
 * confirmation means. F2.8's rule is that nothing extracted enters the catalogue
 * unconfirmed, and the type system enforces that separately: nothing crosses from
 * `CatalogueCandidate` to a live item without a user id (src/onboarding/candidates.ts).
 *
 * Both paths converge on the same database constraint,
 * `active_items_must_be_confirmed`, which is why this one can be written plainly
 * without weakening the other.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function createCatalogueItem(
  userId: string,
  agencyId: string,
  input: CatalogueItemInput,
): Promise<CatalogueItemRow> {
  return withUser(userId, async (client) => {
    const result = await client.query(
      `insert into catalog_items
         (agency_id, name, description, unit, unit_price_cents, floor_price_cents,
          vat_rate, quantity_driver, active, confirmed_by, confirmed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, true, public.current_user_id(), now())
       returning *, 0 as rule_count`,
      [
        agencyId,
        input.name,
        input.description,
        input.unit,
        input.unitPriceCents,
        input.floorPriceCents,
        input.vatRate,
        input.quantityDriver,
      ],
    )
    const row = result.rows[0]
    if (!row) throw new Error('insert returned no row')
    return toCatalogueItem(row)
  })
}

export async function updateCatalogueItem(
  userId: string,
  itemId: string,
  input: CatalogueItemInput,
): Promise<CatalogueItemRow | null> {
  return withUser(userId, async (client) => {
    const result = await client.query(
      `update catalog_items
          set name = $2, description = $3, unit = $4, unit_price_cents = $5,
              floor_price_cents = $6, vat_rate = $7, quantity_driver = $8
        where id = $1
       returning *, (select count(*) from price_rules r where r.catalog_item_id = id) as rule_count`,
      [
        itemId,
        input.name,
        input.description,
        input.unit,
        input.unitPriceCents,
        input.floorPriceCents,
        input.vatRate,
        input.quantityDriver,
      ],
    )
    const row = result.rows[0]
    return row ? toCatalogueItem(row) : null
  })
}

/**
 * Retire an item rather than delete it.
 *
 * A quote already sent references this item through its immutable
 * `quote_versions.calculation_trace`, and a deleted row would leave a document whose
 * figures can no longer be explained — which breaks the transparency the product
 * commits to under I6. Deactivating keeps every past quote reconstructible.
 */
export async function deactivateCatalogueItem(userId: string, itemId: string): Promise<boolean> {
  return withUser(userId, async (client) => {
    const result = await client.query('update catalog_items set active = false where id = $1', [
      itemId,
    ])
    return (result.rowCount ?? 0) > 0
  })
}

function toCatalogueItem(row: Record<string, unknown>): CatalogueItemRow {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ''),
    unit: String(row.unit),
    unitPrice: cents(Number(row.unit_price_cents)),
    floorPrice: cents(Number(row.floor_price_cents)),
    vatRate: Number(row.vat_rate) as 19 | 7 | 0,
    quantityDriver: String(row.quantity_driver) as CatalogueItemRow['quantityDriver'],
    active: Boolean(row.active),
    confirmedAt: row.confirmed_at ? new Date(String(row.confirmed_at)).toISOString() : null,
    priceRuleCount: Number(row.rule_count ?? 0),
  }
}

/** Price bands for one item (F2.9 — Staffelpreise). */
export interface PriceRuleRow {
  id: string
  catalogItemId: string
  minQty: number
  maxQty: number | null
  unitPrice: Cents
}

export async function listPriceRules(userId: string, itemId: string): Promise<PriceRuleRow[]> {
  return withUser(userId, async (client) => {
    const result = await client.query(
      'select * from price_rules where catalog_item_id = $1 order by min_qty',
      [itemId],
    )
    return result.rows.map((row) => ({
      id: String(row.id),
      catalogItemId: String(row.catalog_item_id),
      minQty: Number(row.min_qty),
      maxQty: row.max_qty === null ? null : Number(row.max_qty),
      unitPrice: cents(Number(row.unit_price_cents)),
    }))
  })
}

export async function replacePriceRules(
  userId: string,
  agencyId: string,
  itemId: string,
  bands: Array<{ minQty: number; maxQty: number | null; unitPriceCents: number }>,
): Promise<void> {
  await withUser(userId, async (client) => {
    // Replace wholesale inside the transaction `withUser` already opened. Editing
    // bands in place would leave a window where the ladder has a gap, and a quote
    // priced in that window would be wrong in a way nothing would flag.
    await client.query('delete from price_rules where catalog_item_id = $1', [itemId])
    for (const band of bands) {
      await client.query(
        `insert into price_rules (agency_id, catalog_item_id, min_qty, max_qty, unit_price_cents)
         values ($1, $2, $3, $4, $5)`,
        [agencyId, itemId, band.minQty, band.maxQty, band.unitPriceCents],
      )
    }
  })
}

/** Guardrails (F2.13). One row per agency; owner-only by RLS policy. */
export async function loadGuardrails(userId: string): Promise<Record<string, unknown> | null> {
  return withUser(userId, async (client) => {
    const result = await client.query('select * from guardrails limit 1')
    return result.rows[0] ?? null
  })
}

export async function saveGuardrails(
  userId: string,
  agencyId: string,
  values: {
    minOrderValueCents: number
    maxAutoQuoteValueCents: number
    allowScopeReduction: boolean
    maxNegotiationRounds: number
    quoteValidityDays: number
    autoSendEnabled: boolean
    leadTimeMinDays: number
    capacityPerDay: number
    allowEmoji: boolean
  },
): Promise<void> {
  await withUser(userId, async (client) => {
    await upsertGuardrails(client, agencyId, values)
  })
}

async function upsertGuardrails(
  client: PoolClient,
  agencyId: string,
  v: Parameters<typeof saveGuardrails>[2],
): Promise<void> {
  await client.query(
    `insert into guardrails
       (agency_id, min_order_value_cents, max_auto_quote_value_cents, allow_scope_reduction,
        max_negotiation_rounds, quote_validity_days, auto_send_enabled, lead_time_min_days,
        capacity_per_day, allow_emoji, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     on conflict (agency_id) do update set
       min_order_value_cents = excluded.min_order_value_cents,
       max_auto_quote_value_cents = excluded.max_auto_quote_value_cents,
       allow_scope_reduction = excluded.allow_scope_reduction,
       max_negotiation_rounds = excluded.max_negotiation_rounds,
       quote_validity_days = excluded.quote_validity_days,
       auto_send_enabled = excluded.auto_send_enabled,
       lead_time_min_days = excluded.lead_time_min_days,
       capacity_per_day = excluded.capacity_per_day,
       allow_emoji = excluded.allow_emoji,
       updated_at = now()`,
    [
      agencyId,
      v.minOrderValueCents,
      v.maxAutoQuoteValueCents,
      v.allowScopeReduction,
      v.maxNegotiationRounds,
      v.quoteValidityDays,
      v.autoSendEnabled,
      v.leadTimeMinDays,
      v.capacityPerDay,
      v.allowEmoji,
    ],
  )
}
