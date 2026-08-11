/**
 * Verdicts on drift cards.
 *
 * The same shape as `/api/candidates` next door, and for the same reason: this is
 * one decision with two answers, and splitting accept and dismiss across two routes
 * would put the shared authorisation in two places.
 */

import { type NextRequest } from 'next/server'

import { currentUserId } from '../../../auth/current-user'
import { decideDrift, openDrift } from '../../../drift/repository'
import { currentAgency } from '../../../onboarding/repository'

export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  const userId = await currentUserId()
  if (!userId) return Response.json({ status: 'unauthenticated' }, { status: 401 })

  const agency = await currentAgency(userId)
  if (!agency) return Response.json({ status: 'no_agency' }, { status: 409 })

  return Response.json({ status: 'ok', cards: await openDrift(userId, agency.agencyId) })
}

export async function POST(request: NextRequest): Promise<Response> {
  const userId = await currentUserId()
  if (!userId) return Response.json({ status: 'unauthenticated' }, { status: 401 })

  const agency = await currentAgency(userId)
  if (!agency) return Response.json({ status: 'no_agency' }, { status: 409 })
  // Accepting a drift card writes to the live catalogue, so it is the same
  // authorisation as confirming a candidate: only an owner changes what the
  // business sells (D11).
  if (agency.role !== 'owner') return Response.json({ status: 'forbidden' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return Response.json({ status: 'invalid' }, { status: 400 })
  }

  const driftId = String(body.driftId ?? '')
  const action = String(body.action ?? '')
  if (!driftId) return Response.json({ status: 'invalid' }, { status: 400 })
  if (action !== 'accept' && action !== 'dismiss') {
    return Response.json({ status: 'invalid' }, { status: 400 })
  }

  const decision = await decideDrift(
    userId,
    agency.agencyId,
    driftId,
    action === 'accept' ? 'accepted' : 'dismissed',
  )

  if (decision.outcome === 'not_found') {
    return Response.json({ status: 'not_found' }, { status: 404 })
  }

  // 409 rather than 400: the request was well formed and the owner is allowed to
  // make it. Two of her own numbers disagree, and the answer is a decision only she
  // can take, in a screen where both are editable together.
  if (decision.outcome === 'below_floor') {
    return Response.json(
      {
        status: 'below_floor',
        floorCents: decision.floorCents,
        observedCents: decision.observedCents,
      },
      { status: 409 },
    )
  }

  return Response.json({ status: 'ok' })
}
