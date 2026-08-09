/**
 * `POST /api/webhooks/whatsapp` — inbound from Unipile (Phase E).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS ROUTE IS THE ONLY PLACE `first_inbound_at` IS EVER SET.
 *
 * That column is mitigation 1: a thread nobody wrote to us on cannot be written
 * to. It is set by `record_whatsapp_inbound` and by nothing else, so "we only
 * message people who messaged us" is a property of the schema rather than a rule
 * a future send path could forget.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The tenant is resolved from the *account the message arrived on*, never from
 * the body (F1.4). A webhook body is attacker-controlled: anyone who guesses this
 * URL can post one, which is why the shared secret is checked first and the
 * agency is looked up rather than read.
 *
 * It always answers 200. Unipile retries on anything else, and a retry loop over
 * a message we have already decided we cannot process is noise that buries the
 * messages we can.
 */

import { type NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

import { whatsappUnipileAdapter } from '../../../../channels/adapters/whatsapp-unipile'
import { recordWhatsAppInbound } from '../../../../channels/whatsapp/inbound'

export const runtime = 'nodejs'

interface UnipileWebhookBody {
  account_id?: unknown
  message_id?: unknown
  chat_id?: unknown
  from?: unknown
  from_name?: unknown
  text?: unknown
  timestamp?: unknown
  /** Unipile echoes our own sends back. Those are not inbound. */
  is_sender?: unknown
  message_type?: unknown
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) {
    // 404, not 401: an endpoint that distinguishes "wrong secret" from "no such
    // route" tells someone probing that they have found the right URL.
    return new Response('Not found', { status: 404 })
  }

  let body: UnipileWebhookBody
  try {
    body = (await request.json()) as UnipileWebhookBody
  } catch {
    return Response.json({ ok: true, ignored: 'unparseable' })
  }

  // Our own outbound, echoed back. Recording it as inbound would grant permission
  // to send on a thread we opened — which is mitigation 1 defeating itself.
  if (body.is_sender === true) return Response.json({ ok: true, ignored: 'own_message' })

  const accountId = str(body.account_id)
  const messageId = str(body.message_id)
  const chatId = str(body.chat_id)
  const fromPhone = str(body.from)

  if (!accountId || !messageId || !chatId || !fromPhone) {
    return Response.json({ ok: true, ignored: 'incomplete' })
  }

  const result = await recordWhatsAppInbound({
    providerAccountId: accountId,
    peerPhone: fromPhone,
    providerThreadId: chatId,
  })

  if (!result) {
    // An account we do not know. Logged once and acknowledged, because the
    // alternative is Unipile retrying it until someone notices.
    console.warn(
      JSON.stringify({ event: 'whatsapp_unknown_account', providerAccountId: accountId }),
    )
    return Response.json({ ok: true, ignored: 'unknown_account' })
  }

  // The envelope. Everything downstream reads this and never the webhook body —
  // the constraint the whole adapter layer exists for, paying off here for the
  // first time on a channel we did not design it around.
  const event = whatsappUnipileAdapter.toInboundEvent(
    {
      messageId,
      chatId,
      fromPhone,
      fromName: str(body.from_name),
      text: typeof body.text === 'string' ? body.text : null,
      sentAt: typeof body.timestamp === 'string' || typeof body.timestamp === 'number'
        ? body.timestamp
        : null,
      // Voice notes are stored and flagged, not transcribed (D5). Transcription
      // needs whisper.cpp in a worker container, which does not exist yet.
      hasVoiceNote: body.message_type === 'audio' || body.message_type === 'voice',
    },
    {
      agencyId: result.agencyId,
      now: new Date().toISOString(),
      newId: () => crypto.randomUUID(),
    },
  )

  console.info(
    JSON.stringify({
      event: 'whatsapp_inbound',
      agencyId: event.agencyId,
      idempotencyKey: event.idempotencyKey,
      isNewThread: result.isNewThread,
      hasInquiry: result.inquiryId !== null,
    }),
  )

  // Where this goes next: a customer's message joins her enquiry and runs the
  // qualifying loop; the caterer's reply goes to `rework.ts`. Both are the same
  // envelope the hosted chat already produces, which is the point — but routing
  // by thread role needs the account link flow (Phase F onboarding) to exist
  // before it can be exercised end to end.
  return Response.json({ ok: true, eventId: event.eventId })
}

/**
 * A shared secret, compared in constant time.
 *
 * Unipile signs nothing we can verify per-message, so a secret in a header is the
 * available control. Absent configuration means the endpoint is closed, not open:
 * an unconfigured webhook that accepted anything would be a public write.
 */
function authorised(request: NextRequest): boolean {
  const expected = process.env.UNIPILE_WEBHOOK_SECRET
  if (!expected) return false
  const provided = request.headers.get('x-webhook-secret') ?? ''
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
