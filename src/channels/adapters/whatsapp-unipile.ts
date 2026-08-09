/**
 * The WhatsApp adapter (Phase E, D12 by way of N3).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS THE FILE THE ENVELOPE WAS BUILT FOR, AND IT CHANGES NOTHING DOWNSTREAM.
 *
 * The adapter contract's whole claim is that adding a channel is one pure
 * function emitting an `InboundEvent`, with zero changes anywhere behind it. This
 * is the first time that claim is tested against a channel we did not design the
 * envelope around — a webhook from a third party, a phone number instead of a
 * cookie, a provider thread id instead of a session.
 *
 * It holds. Nothing below this file knows WhatsApp exists.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PROVIDER IS UNOFFICIAL, AND THAT IS A DECISION, NOT AN OVERSIGHT.
 *
 * Unipile links WhatsApp through the WhatsApp Web session mechanism, not the Meta
 * Cloud API. CLAUDE.md §4 forbids exactly this and the owner has overruled it
 * (N3), with two mandatory mitigations that live in migration 0013 rather than in
 * this file: threads are inbound-initiated only, and there is a per-account daily
 * cap with a kill switch.
 *
 * What this file owes that decision is *portability*. Everything provider-shaped
 * stops at `UnipileMessagePayload`; the Cloud API's webhook has a different shape
 * and would be a second payload type feeding the same builder. Do not let a
 * Unipile field name past this module.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { detectLanguageAndFormality } from '../../i18n/detect'
import { type EnvelopeAttachment, type InboundEvent, idempotencyKey } from '../envelope'
import { defineAdapter } from '../registry'

/**
 * What Unipile posts, reduced to what we use.
 *
 * Untrusted, and doubly so: it arrives over the public internet from a third
 * party, and its contents were typed by a stranger. Note the absence of an agency
 * id — the tenant is resolved from the *account* the message arrived on, in the
 * route, before this runs (F1.4).
 */
export interface UnipileMessagePayload {
  /** Provider message id. The idempotency anchor: webhooks retry. */
  messageId: string
  /** Provider conversation id. */
  chatId: string
  /** E.164, sender. */
  fromPhone: string
  /** WhatsApp profile name. Volunteered by the sender, so not to be trusted as identity. */
  fromName?: string | null
  text?: string | null
  /** Provider timestamp, ISO or epoch millis. */
  sentAt?: string | number | null
  /** Already downloaded, stored and scanned by the route (F1.10). */
  attachments?: EnvelopeAttachment[]
  /** Voice notes arrive here. Stored and flagged, not transcribed at launch (D5). */
  hasVoiceNote?: boolean
}

export const whatsappUnipileAdapter = defineAdapter<UnipileMessagePayload>(
  'whatsapp',
  (payload, context): InboundEvent => {
    const text = payload.text ?? null
    const detection = detectLanguageAndFormality(text ?? '')

    return {
      eventId: context.newId(),
      agencyId: context.agencyId,
      channel: 'whatsapp',
      direction: 'inbound',
      externalIds: {
        messageId: payload.messageId,
        threadId: payload.chatId,
      },
      occurredAt: providerTime(payload.sentAt, context.now),
      receivedAt: context.now,
      sender: {
        displayName: payload.fromName ?? null,
        // WhatsApp carries no email. The field exists on the envelope for every
        // channel and is null where the channel has nothing to put in it — which
        // is the point of a canonical shape.
        email: null,
        phoneE164: payload.fromPhone,
        isKnownContact: context.isKnownContact ?? false,
      },
      content: {
        text,
        languageDetected: detection.language,
        formalityDetected: detection.formality,
        // WhatsApp models per-message replies, but the qualifying loop reads the
        // request state rather than the transcript, so threading carries no
        // information it would use. Null rather than a field nothing consumes.
        quotedReplyTo: null,
        interactive: null,
      },
      attachments: payload.attachments ?? [],
      rawPayloadRef: context.rawPayloadRef ?? null,
      idempotencyKey: idempotencyKey('whatsapp', payload.messageId),
    }
  },
)

/**
 * The provider's timestamp, when it is sane.
 *
 * Same reasoning as the hosted-chat adapter, and the same defence: a third
 * party's clock is no more trustworthy than a browser's, and SLA timers run off
 * `receivedAt` either way. Epoch millis are accepted because Unipile sends both
 * shapes depending on the event.
 */
const MAX_CLOCK_SKEW_FORWARD_MS = 5 * 60 * 1000
const MAX_OFFLINE_BACKLOG_MS = 24 * 60 * 60 * 1000

export function providerTime(
  sentAt: string | number | null | undefined,
  serverNow: string,
): string {
  if (sentAt === null || sentAt === undefined || sentAt === '') return serverNow
  const parsed = typeof sentAt === 'number' ? sentAt : Date.parse(sentAt)
  const server = Date.parse(serverNow)
  if (Number.isNaN(parsed) || Number.isNaN(server)) return serverNow
  const delta = parsed - server
  if (delta > MAX_CLOCK_SKEW_FORWARD_MS) return serverNow
  // A day, not an hour: WhatsApp genuinely delivers messages a phone composed
  // while out of signal, and the customer's own ordering is the right one.
  if (delta < -MAX_OFFLINE_BACKLOG_MS) return serverNow
  return new Date(parsed).toISOString()
}
