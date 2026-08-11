/**
 * Verdicts on candidates.
 *
 * One endpoint, three actions, because they are the same decision with different
 * answers and splitting them across three routes would put the shared
 * authorisation and the shared shape in three places.
 */

import { type NextRequest } from 'next/server'

import { currentUserId } from '../../../auth/current-user'
import { confirmMany, confirmOne, loadQueue, rejectOne } from '../../../candidates/repository'
import { currentAgency } from '../../../onboarding/repository'

export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  const userId = await currentUserId()
  if (!userId) return Response.json({ status: 'unauthenticated' }, { status: 401 })

  return Response.json({ status: 'ok', queue: await loadQueue(userId) })
}

export async function POST(request: NextRequest): Promise<Response> {
  const userId = await currentUserId()
  if (!userId) return Response.json({ status: 'unauthenticated' }, { status: 401 })

  const agency = await currentAgency(userId)
  if (!agency) return Response.json({ status: 'no_agency' }, { status: 409 })
  // Only an owner may change what the business sells. The database says so too —
  // this is the early, friendlier half of the same rule.
  if (agency.role !== 'owner') return Response.json({ status: 'forbidden' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return Response.json({ status: 'invalid' }, { status: 400 })
  }

  const action = String(body.action ?? '')

  try {
    if (action === 'confirm') {
      const id = String(body.candidateId ?? '')
      const edits = (body.edits ?? {}) as Record<string, unknown>
      const itemId = await confirmOne(userId, id, edits)
      return Response.json({ status: 'confirmed', catalogItemId: itemId })
    }

    if (action === 'reject') {
      await rejectOne(userId, String(body.candidateId ?? ''), String(body.reason ?? ''))
      return Response.json({ status: 'rejected' })
    }

    if (action === 'confirm_many') {
      const ids = Array.isArray(body.candidateIds) ? body.candidateIds.map(String) : []
      const confirmed = await confirmMany(userId, ids)
      return Response.json({ status: 'confirmed_many', confirmed })
    }

    return Response.json({ status: 'invalid', problem: 'unknown_action' }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    // Two people, or two tabs, deciding the same candidate. The second one is not
    // an error worth alarming anybody about — the decision stands, it simply was
    // not this request that made it.
    if (message.includes('already decided')) {
      return Response.json({ status: 'already_decided' }, { status: 409 })
    }
    if (message.includes('no such candidate')) {
      return Response.json({ status: 'not_found' }, { status: 404 })
    }
    throw error
  }
}
