/**
 * `POST /api/inquiries/{id}/quote` — the owner's execution button.
 *
 * One press: price the enquiry against this tenant's catalogue, run the guardrails
 * on what came out, write a numbered quote, and hand back the link the customer
 * opens. It is the last missing segment of "vom Chat zum verschickten Angebot in
 * unter 5 Minuten" — every other piece existed and nothing joined them.
 *
 * It is a POST from an authenticated agency member and nothing else can reach it.
 * That is not incidental: `issue_quote` is `security invoker`, so a worker with no
 * identity gets no inquiry and no quote, and invariants 3 and 4 hold structurally
 * rather than by anyone remembering.
 */

import { type NextRequest } from 'next/server'

import { currentUserId } from '../../../../../auth/current-user'
import { loadInquiry } from '../../../../../inbox/repository'
import { currentAgency } from '../../../../../onboarding/repository'
import { issueQuote, quotePath, reissueQuoteLink } from '../../../../../quote/issue'

export const runtime = 'nodejs'

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const userId = await currentUserId()
  if (!userId) return Response.json({ status: 'unauthenticated' }, { status: 401 })

  const agency = await currentAgency(userId)
  if (!agency) return Response.json({ status: 'no_agency' }, { status: 409 })

  const { id } = await context.params

  const inquiry = await loadInquiry(userId, id)
  // RLS already turned "another tenant's enquiry" into "no such enquiry" before
  // this line ran, so there is nothing here to leak by answering plainly.
  if (!inquiry) return Response.json({ status: 'not_found' }, { status: 404 })

  const outcome = await issueQuote({
    userId,
    agencyId: agency.agencyId,
    inquiryId: id,
    request: inquiry.request ?? null,
  })

  if (!outcome.ok) {
    if (outcome.reason === 'guardrail') {
      // 200, not an error status. A guardrail firing is the product working
      // correctly — one of its two legitimate outcomes — and the owner needs the
      // explanation, not a failure banner. The client renders `ownerMessage`.
      return Response.json({
        status: 'held',
        rule: outcome.rule,
        message: outcome.ownerMessage,
      })
    }

    const status = outcome.reason === 'unavailable' ? 503 : 422
    return Response.json({ status: 'blocked', reason: outcome.reason }, { status })
  }

  return Response.json(
    {
      status: outcome.quote.alreadyIssued ? 'already_issued' : 'issued',
      quoteNumber: outcome.quote.quoteNumber,
      grossTotalCents: outcome.quote.grossTotalCents,
      validUntil: outcome.quote.validUntil,
      // Present only on a fresh issue. A re-press returns the existing quote's
      // number, but only the token's hash was stored, so there is no link to give
      // back. Rotating it here would silently break the link the customer may
      // already be holding — recovery is the deliberate PUT below.
      path: outcome.quote.alreadyIssued ? null : quotePath(outcome.quote.token),
    },
    { status: 201 },
  )
}

/**
 * Replace the link on a quote that has already gone out.
 *
 * Separate verb, separate button, and the UI states the consequence: the previous
 * link stops working. That is the point when it is used for revocation, and the
 * reason it is not what pressing "senden" a second time does.
 */
export async function PUT(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const userId = await currentUserId()
  if (!userId) return Response.json({ status: 'unauthenticated' }, { status: 401 })

  const agency = await currentAgency(userId)
  if (!agency) return Response.json({ status: 'no_agency' }, { status: 409 })

  const { id } = await context.params
  const replaced = await reissueQuoteLink(userId, agency.agencyId, id)
  if (!replaced) return Response.json({ status: 'not_found' }, { status: 404 })

  return Response.json({
    status: 'replaced',
    quoteNumber: replaced.quoteNumber,
    path: quotePath(replaced.token),
  })
}
