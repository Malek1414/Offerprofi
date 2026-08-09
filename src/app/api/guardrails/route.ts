/**
 * Guardrails (F2.13).
 *
 * Owner-only, and enforced by the database rather than here: the `guardrails_owner_write`
 * RLS policy in migration 0002 checks `is_agency_owner(agency_id)`, so a teammate's
 * write matches no row however the request reaches this handler (F6.15 excludes members
 * from guardrail configuration). Checking the role in application code as well would be
 * a second source of truth about who may do this, and the weaker of the two.
 */

import { type NextRequest } from 'next/server'

import { currentUserId } from '../../../auth/current-user'
import { validateGuardrails } from '../../../onboarding/guardrail-form'
import { currentAgency, saveGuardrails } from '../../../onboarding/repository'

export const runtime = 'nodejs'

export async function PUT(request: NextRequest): Promise<Response> {
  const userId = await currentUserId()
  if (!userId) return json({ status: 'unauthenticated' }, 401)

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ status: 'invalid', problems: [] }, 400)
  }

  const validated = validateGuardrails({
    minOrderValue: String(body.minOrderValue ?? ''),
    maxAutoQuoteValue: String(body.maxAutoQuoteValue ?? ''),
    allowScopeReduction: Boolean(body.allowScopeReduction),
    maxNegotiationRounds: String(body.maxNegotiationRounds ?? ''),
    quoteValidityDays: String(body.quoteValidityDays ?? ''),
    autoSendEnabled: Boolean(body.autoSendEnabled),
    leadTimeMinDays: String(body.leadTimeMinDays ?? ''),
    capacityPerDay: String(body.capacityPerDay ?? ''),
    allowEmoji: Boolean(body.allowEmoji),
  })
  if (!validated.ok) return json({ status: 'invalid', problems: validated.problems }, 400)

  const agency = await currentAgency(userId)
  if (!agency) return json({ status: 'no_agency' }, 409)

  try {
    await saveGuardrails(userId, agency.agencyId, validated.value)
  } catch {
    // The most likely cause by far is the owner-only policy rejecting a teammate.
    // Reported as a forbidden rather than a server error, without confirming whether
    // a guardrail row exists.
    return json({ status: 'forbidden' }, 403)
  }

  return json({ status: 'saved' })
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
