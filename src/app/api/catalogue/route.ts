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
  createCatalogueItem,
  currentAgency,
  deactivateCatalogueItem,
  updateCatalogueItem,
} from '../../../onboarding/repository'

export const runtime = 'nodejs'

export async function POST(request: NextRequest): Promise<Response> {
  const userId = await currentUserId()
  if (!userId) return json({ status: 'unauthenticated' }, 401)

  const body = (await readJson(request)) as Record<string, string> | null
  if (!body) return json({ status: 'invalid', problems: [] }, 400)

  const validated = validateCatalogueItem({
    name: body.name ?? '',
    description: body.description ?? '',
    unit: body.unit ?? '',
    unitPrice: body.unitPrice ?? '',
    floorPrice: body.floorPrice ?? '',
    vatRate: body.vatRate ?? '',
    quantityDriver: body.quantityDriver ?? '',
  })
  if (!validated.ok) return json({ status: 'invalid', problems: validated.problems }, 400)

  const agency = await currentAgency(userId)
  if (!agency) return json({ status: 'no_agency' }, 409)

  const item = await createCatalogueItem(userId, agency.agencyId, validated.value)
  return json({ status: 'created', item }, 201)
}

export async function PATCH(request: NextRequest): Promise<Response> {
  const userId = await currentUserId()
  if (!userId) return json({ status: 'unauthenticated' }, 401)

  const body = (await readJson(request)) as Record<string, string> | null
  if (!body?.id) return json({ status: 'invalid', problems: [] }, 400)

  const validated = validateCatalogueItem({
    name: body.name ?? '',
    description: body.description ?? '',
    unit: body.unit ?? '',
    unitPrice: body.unitPrice ?? '',
    floorPrice: body.floorPrice ?? '',
    vatRate: body.vatRate ?? '',
    quantityDriver: body.quantityDriver ?? '',
  })
  if (!validated.ok) return json({ status: 'invalid', problems: validated.problems }, 400)

  const item = await updateCatalogueItem(userId, body.id, validated.value)
  // Null means RLS matched nothing — either the row does not exist or it belongs to
  // someone else. The two are indistinguishable here on purpose: distinguishing them
  // would confirm the existence of another tenant's row.
  if (!item) return json({ status: 'not_found' }, 404)
  return json({ status: 'updated', item })
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
