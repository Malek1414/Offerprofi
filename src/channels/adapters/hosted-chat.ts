/**
 * The hosted-chat adapter (F1.3).
 *
 * Hosted chat is the launch channel and the primary one (D1) — reached from an
 * Instagram bio link, a website embed, a QR code or a Google Business Profile. It
 * exists because the alternatives are worse at launch: WhatsApp needs Meta approval
 * and imposes a 24-hour window, message templates and per-message fees, while a
 * page we serve has none of those and a richer UI.
 *
 * It is also the *first* adapter, which makes it the shape every later one copies.
 * So it is written to be boring: it does nothing a webhook-driven channel could not
 * also do, and it takes no shortcut just because the payload happens to originate
 * from our own front end. If this adapter reached around the envelope, every
 * adapter after it would too.
 */

import { defineAdapter } from '../registry'
import { idempotencyKey, type EnvelopeAttachment, type InboundEvent } from '../envelope'
import { detectLanguageAndFormality } from '../../i18n/detect'

/**
 * What the chat front end posts.
 *
 * Untrusted. It arrives from a browser we do not control, over a public endpoint
 * with no account behind it. Note what is absent: no `agencyId` (F1.4 — resolved
 * server-side from the slug), no `inquiryId`, no state of any kind. The client
 * carries a session token and a message; everything else is ours to decide.
 */
export interface HostedChatPayload {
  /** Client-generated per turn; the idempotency anchor for double-submits. */
  turnId: string
  /** Server-side session id, resolved from the cookie before the adapter runs. */
  sessionId: string
  text: string
  /** Suggested-reply chip, when the customer tapped rather than typed. */
  interactive?: { type: string; payload: string } | null
  /** Already uploaded and scanned; the adapter only references them (F1.10). */
  attachments?: EnvelopeAttachment[]
  /** ISO timestamp from the client. Advisory only — see below. */
  clientSentAt?: string
  /** Volunteered in the chat, or carried over from a resumed session. */
  displayName?: string | null
  email?: string | null
  phoneE164?: string | null
}

export const hostedChatAdapter = defineAdapter<HostedChatPayload>(
  'hosted_chat',
  (payload, context): InboundEvent => {
    const detection = detectLanguageAndFormality(payload.text ?? '')

    // The client clock is not trusted for anything that matters. A browser can
    // report any time it likes, including one that would place a message before
    // the session that carries it. It is recorded as `occurredAt` for ordering
    // within a burst of the customer's own messages, but only when it is sane;
    // `receivedAt` is always ours, and SLA timers run off `receivedAt`.
    const occurredAt = plausibleClientTime(payload.clientSentAt, context.now)

    return {
      eventId: context.newId(),
      agencyId: context.agencyId,
      channel: 'hosted_chat',
      direction: 'inbound',
      externalIds: {
        messageId: payload.turnId,
        threadId: payload.sessionId,
      },
      occurredAt,
      receivedAt: context.now,
      sender: {
        displayName: payload.displayName ?? null,
        email: payload.email ?? null,
        phoneE164: payload.phoneE164 ?? null,
        isKnownContact: context.isKnownContact ?? false,
      },
      content: {
        text: payload.text ?? null,
        languageDetected: detection.language,
        formalityDetected: detection.formality,
        // Hosted chat is a single linear thread, so every message replies to the
        // one before it and per-message threading carries no information.
        quotedReplyTo: null,
        interactive: payload.interactive ?? null,
      },
      attachments: payload.attachments ?? [],
      rawPayloadRef: context.rawPayloadRef ?? null,
      idempotencyKey: idempotencyKey('hosted_chat', payload.turnId),
    }
  },
)

/**
 * Accept a client timestamp only inside a window either side of server time;
 * otherwise substitute ours.
 *
 * Five minutes forward covers ordinary clock skew. An hour back covers a phone that
 * composed a message offline in a venue basement and sent it on reconnect — a real
 * scenario for this product's customers, and one where the customer's own ordering
 * is the correct ordering.
 */
const MAX_CLOCK_SKEW_FORWARD_MS = 5 * 60 * 1000
const MAX_OFFLINE_BACKLOG_MS = 60 * 60 * 1000

function plausibleClientTime(clientSentAt: string | undefined, serverNow: string): string {
  if (!clientSentAt) return serverNow
  const client = Date.parse(clientSentAt)
  const server = Date.parse(serverNow)
  if (Number.isNaN(client) || Number.isNaN(server)) return serverNow
  const delta = client - server
  if (delta > MAX_CLOCK_SKEW_FORWARD_MS) return serverNow
  if (delta < -MAX_OFFLINE_BACKLOG_MS) return serverNow
  return new Date(client).toISOString()
}
