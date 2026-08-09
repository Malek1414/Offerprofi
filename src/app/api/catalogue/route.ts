/**
 * Catalogue items (F2.9, F2.11).
 *
 * POST creates, PATCH updates, DELETE retires. Every handler resolves the user from
 * the session cookie and hands the id to the repository, which opens a transaction
 * with `app.current_user_id` set — so RLS decides which rows exist for this caller and
 * a tampered item id simply matches nothing.
 *
 * There is deliberately no GET. The list is server-rendered by the page, which already
 * has the session; an endpoint returning a tenant's whole price list would be a second
 * way to reach it, and the only reason to build one is to feed a client component that
 * does not need to exist.
 */

import { type NextRequest } from 'next/server'

import { currentUserId } from '../../../auth/current-user'
import { validateCatalogueItem } from '../../../onboarding/catalogue-form'
import {
  supportsPriceBands,
  validatePriceBands,
  type PriceBandForm,
  type PriceBandProblem,
  type ValidatedPriceBand,
} from '../../../onboarding/price-band-form'
import {
  createCatalogueItem,
  currentAgency,
  deactivateCatalogueItem,
  replacePriceRules,
  updateCatalogueItem,
} from '../../../onboarding/repository'
import type { QuantityDriver } from '../../../domain/catalogue'

export const runtime = 'nodejs'

/**
 * Bands are validated against the item's *validated* floor, not the one the client
 * sent, so a request that lowers the floor and adds a sub-floor band in the same call
 * is checked against the floor it will actually be saved with.
 */
function readBands(
  body: Record<string, unknown>,
  floorPriceCents: number,
  driver: QuantityDriver,
): { ok: true; value: ValidatedPriceBand[] } | { ok: false; problems: PriceBandProblem[] } {
  // A flat item has no quantity to band on. Any bands sent for one are dropped rather
  // than rejected — the editor hides the control, so this is a stale client, not an
  // owner making a mistake she can see.
  if (!supportsPriceBands(driver)) return { ok: true, value: [] }

  const raw = Array.isArray(body.priceBands) ? body.priceBands : []
  const forms: PriceBandForm[] = raw.map((row) => {
    const r = (row ?? {}) as Record<string, unknown>
    return { fromQty: String(r.fromQty ?? ''), unitPrice: String(r.unitPrice ?? '') }
  })

  return validatePriceBands(forms, { floorPriceCents })
}

export async function POST(request: NextRequest): Promise<Response> {
  const userId = await currentUserId()
  if (!userId) return json({ status: 'unauthenticated' }, 401)

  const body = (await readJson(request)) as Record<string, unknown> | null
  if (!body) return json({ status: 'invalid', problems: [] }, 400)

  const validated = validateCatalogueItem(itemFields(body))
  if (!validated.ok) return json({ status: 'invalid', problems: validated.problems }, 400)

  const bands = readBands(body, validated.value.floorPriceCents, validated.value.quantityDriver)
  if (!bands.ok) return json({ status: 'invalid', bandProblems: bands.problems }, 400)

  const agency = await currentAgency(userId)
  if (!agency) return json({ status: 'no_agency' }, 409)

  const item = await createCatalogueItem(userId, agency.agencyId, validated.value)
  if (bands.value.length > 0) {
    await replacePriceRules(userId, agency.agencyId, item.id, bands.value)
  }
  return json({ status: 'created', item: { ...item, priceRuleCount: bands.value.length } }, 201)
}

export async function PATCH(request: NextRequest): Promise<Response> {
  const userId = await currentUserId()
  if (!userId) return json({ status: 'unauthenticated' }, 401)

  const body = (await readJson(request)) as Record<string, unknown> | null
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return json({ status: 'invalid', problems: [] }, 400)

  const validated = validateCatalogueItem(itemFields(body!))
  if (!validated.ok) return json({ status: 'invalid', problems: validated.problems }, 400)

  const bands = readBands(body!, validated.value.floorPriceCents, validated.value.quantityDriver)
  if (!bands.ok) return json({ status: 'invalid', bandProblems: bands.problems }, 400)

  const agency = await currentAgency(userId)
  if (!agency) return json({ status: 'no_agency' }, 409)

  const item = await updateCatalogueItem(userId, id, validated.value)
  // Null means RLS matched nothing — either the row does not exist or it belongs to
  // someone else. The two are indistinguishable here on purpose: distinguishing them
  // would confirm the existence of another tenant's row.
  if (!item) return json({ status: 'not_found' }, 404)

  // Unconditional, including for an empty ladder — that is how the last band is
  // deleted. Skipping the call when there are no bands would make removal impossible.
  await replacePriceRules(userId, agency.agencyId, id, bands.value)

  return json({ status: 'updated', item: { ...item, priceRuleCount: bands.value.length } })
}

function itemFields(body: Record<string, unknown>) {
  const str = (key: string) => (typeof body[key] === 'string' ? (body[key] as string) : '')
  return {
    name: str('name'),
    description: str('description'),
    unit: str('unit'),
    unitPrice: str('unitPrice'),
    floorPrice: str('floorPrice'),
    costPrice: str('costPrice'),
    vatRate: str('vatRate'),
    quantityDriver: str('quantityDriver'),
  }
}

export async function DELETE(request: NextRequest): Promise<Response> {
  const userId = await currentUserId()
  if (!userId) return json({ status: 'unauthenticated' }, 401)

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return json({ status: 'invalid' }, 400)

  // Retires rather than deletes — a sent quote references this item through its
  // immutable calculation trace, and a deleted row would leave a document whose
  // figures can no longer be explained (I6).
  const removed = await deactivateCatalogueItem(userId, id)
  if (!removed) return json({ status: 'not_found' }, 404)
  return json({ status: 'retired' })
}

async function readJson(request: NextRequest): Promise<unknown | null> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
