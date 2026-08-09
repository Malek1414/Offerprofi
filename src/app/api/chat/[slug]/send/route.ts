/**
 * `POST /api/chat/{slug}/send` — she presses send (Phase D, D10's customer half).
 *
 * The one moment in the flow that is hers alone. The agent asks questions and
 * writes summaries; it never decides that an enquiry is finished, and it never
 * sends one. This endpoint is reachable only with her session cookie.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT NEVER REFUSES TO SEND.
 *
 * Not for a request with fields missing, not for one with low confidence, not for
 * one the agent escalated. "Your enquiry is not complete enough to send" is
 * software turning a customer away, which is the exact thing Invariant 1 exists to
 * make impossible — and the caterer would rather have a thin request than none.
 * Completeness decides what the assistant *asks*, never what she is *allowed* to
 * do.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Nothing binding is created (I3). No price exists anywhere in what this produces
 * — the caterer is the first party to attach one, and that is Phase B2 on his copy
 * of the document.
 */

import { type NextRequest } from 'next/server'

import { SESSION_COOKIE_NAME, hashSessionToken, verifySessionCookie } from '../../../../../chat/session'
import { resolveAgencyBySlug } from '../../../../../lib/agency'
import { mintRequestToken, requestPath } from '../../../../../requests/links'
import { inquiryForSession, sendRequestToOwner } from '../../../../../requests/repository'

export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params

  const agency = await resolveAgencyBySlug(slug)
  if (!agency) return new Response('Not found', { status: 404 })

  const secret = process.env.CHAT_SESSION_SECRET
  if (!secret) throw new Error('CHAT_SESSION_SECRET is not set')

  const token = verifySessionCookie(request.cookies.get(SESSION_COOKIE_NAME)?.value, secret)
  if (!token) {
    // No session, no conversation to send. Not a refusal of anybody: there is
    // nothing here to hand over.
    return new Response('Not found', { status: 404 })
  }

  const found = await inquiryForSession(agency.id, hashSessionToken(token))
  if (!found) return new Response('Not found', { status: 404 })

  const customer = mintRequestToken()
  const owner = mintRequestToken()

  const result = await sendRequestToOwner({
    agencyId: agency.id,
    inquiryId: found.inquiryId,
    customerTokenHash: customer.tokenHash,
    ownerTokenHash: owner.tokenHash,
  })

  if (!result) return new Response('Not found', { status: 404 })

  if (result.alreadySent) {
    // Pressing send twice is one send. She gets a fresh link to nothing new rather
    // than an error — but the tokens minted above were never stored, so hers is
    // dead. Returning the conversation to its sent state is the honest answer.
    return Response.json({ alreadySent: true }, { status: 200 })
  }

  // Phase E replaces this with a WhatsApp message carrying the same URL. Until the
  // adapter exists the link has to be reachable *somehow*, and a structured server
  // log is the honest interim — it is not on any screen, and no customer can see it.
  console.info(
    JSON.stringify({
      event: 'request_ready_for_owner',
      agencyId: agency.id,
      inquiryId: found.inquiryId,
      ownerUrl: requestPath(owner.token),
    }),
  )

  return Response.json(
    { url: requestPath(customer.token), state: result.state, alreadySent: false },
    { status: 201 },
  )
}
