import { type NextRequest } from 'next/server'

import { currentUserId } from '../../../auth/current-user'
import { validateBrand } from '../../../onboarding/brand-form'
import { currentAgency, saveBrandProfile } from '../../../onboarding/repository'

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

  const validated = validateBrand({ colorPrimary: String(body.colorPrimary ?? '') })
  if (!validated.ok) return json({ status: 'invalid', problems: validated.problems }, 400)

  const agency = await currentAgency(userId)
  if (!agency) return json({ status: 'no_agency' }, 409)
  if (agency.role !== 'owner') return json({ status: 'forbidden' }, 403)

  try {
    await saveBrandProfile(userId, agency.agencyId, validated.value.colorPrimary)
  } catch {
    return json({ status: 'forbidden' }, 403)
  }

  return json({ status: 'saved', colorPrimary: validated.value.colorPrimary })
}

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, { status })
}
