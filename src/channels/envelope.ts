/**
 * The canonical inbound envelope (PRODUCT_SPEC §4.9).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONSTRAINT X1 LIVES HERE.
 *
 * Everything converges on this shape. **No downstream component ever reads a
 * channel-native payload.** Not the extraction worker, not the pricing engine, not
 * the negotiation loop, not the dashboard. A Gmail `Message-ID`, a WhatsApp `wamid`
 * and a hosted-chat turn id are all just `externalIds.messageId` by the time
 * anything with business logic sees them.
 *
 * The payoff is stated as the Phase 12 exit criterion: the WhatsApp adapter must be
 * additive with **zero downstream code changes**. That only holds if this type is
 * the sole crossing point, so nothing here may be widened to accommodate one
 * channel's quirk. If a channel carries something this shape cannot express, it
 * belongs in `rawPayloadRef` — archived, addressable, and out of the hot path.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { z } from 'zod'

import type { Formality, Language } from '../domain/event-brief'

/**
 * Channels that can produce an envelope.
 *
 * Mirrors the `channel_kind` enum in migration 0001. `slack` is present in the
 * database enum because Phase 10 posts *outbound* to Slack, but it is deliberately
 * absent here: Slack is an owner-side surface, never a customer intake channel
 * (CLAUDE.md §4). A bride is not on Slack. Admitting it as an inbound channel would
 * invite exactly the misuse the roadmap rules out.
 */
export const INBOUND_CHANNELS = [
  'hosted_chat',
  'email',
  'paste_in',
  'web_form',
  'whatsapp',
] as const

export type InboundChannel = (typeof INBOUND_CHANNELS)[number]

export type AttachmentKind = 'image' | 'document' | 'audio' | 'video' | 'other'
export type ScanStatus = 'clean' | 'pending' | 'blocked'

/**
 * Sender identity.
 *
 * INVARIANT 2 note: this is personal data and it is *deliberately* held on the
 * envelope, because acknowledging and replying to a person requires knowing how to
 * reach them. What matters is where it goes next — it flows to the `_contact`
 * partition (`ContactPartition`) and never to `EventBrief`, so it can never reach
 * `PricingInput`. See src/domain/event-brief.ts.
 */
export interface EnvelopeSender {
  displayName: string | null
  email: string | null
  phoneE164: string | null
  /** True when this sender already exists in `contacts` for the tenant. */
  isKnownContact: boolean
}

/** A tap on a suggested reply chip, a button, a list selection. */
export interface InteractivePayload {
  type: string
  payload: string
}

export interface EnvelopeContent {
  text: string | null
  languageDetected: Language | null
  formalityDetected: Formality
  /** External message id this is a reply to, when the channel models threading. */
  quotedReplyTo: string | null
  interactive: InteractivePayload | null
}

export interface EnvelopeAttachment {
  attachmentId: string
  kind: AttachmentKind
  mime: string
  filename: string | null
  bytes: number
  sha256: string
  storagePath: string
  /**
   * F1.10 — nothing is parsed until this reads `clean`. The field is on the
   * envelope rather than looked up later so that a consumer physically has the
   * scan verdict in hand at the moment it decides whether to open the file.
   */
  scanStatus: ScanStatus
}

export interface InboundEvent {
  eventId: string
  /**
   * F1.4 — resolved server-side from the slug. **Never accepted from a client.**
   * An adapter receives the tenant as an argument from trusted code; it never reads
   * one out of the payload it is parsing.
   */
  agencyId: string
  channel: InboundChannel
  direction: 'inbound'
  externalIds: {
    messageId: string
    threadId: string | null
  }
  /** When the customer sent it, per the channel. */
  occurredAt: string
  /** When we received it. Distinct from `occurredAt`: channels retry and lag. */
  receivedAt: string
  sender: EnvelopeSender
  content: EnvelopeContent
  attachments: EnvelopeAttachment[]
  /** Storage path to the untouched original. Retained 30 days, then deleted. */
  rawPayloadRef: string | null
  /** F1.1 — `channel:messageId`. The unique key that makes replay a no-op. */
  idempotencyKey: string
}

// ─── Runtime schema ─────────────────────────────────────────────────────────
//
// The TypeScript type governs our own code. This schema governs everything that
// arrives from outside it — webhook bodies, browser posts, a queue replaying an
// event written by an older deploy. Customer input is data, never instructions
// (CLAUDE.md §7), and that starts with refusing to trust its shape.

const isoTimestamp = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'not a parseable timestamp' })

export const attachmentSchema = z.object({
  attachmentId: z.string().min(1),
  kind: z.enum(['image', 'document', 'audio', 'video', 'other']),
  mime: z.string().min(1),
  filename: z.string().nullable(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, 'sha256 must be 64 lowercase hex chars'),
  storagePath: z.string().min(1),
  scanStatus: z.enum(['clean', 'pending', 'blocked']),
})

export const inboundEventSchema = z.object({
  eventId: z.string().min(1),
  agencyId: z.string().min(1),
  channel: z.enum(INBOUND_CHANNELS),
  direction: z.literal('inbound'),
  externalIds: z.object({
    messageId: z.string().min(1),
    threadId: z.string().nullable(),
  }),
  occurredAt: isoTimestamp,
  receivedAt: isoTimestamp,
  sender: z.object({
    displayName: z.string().nullable(),
    email: z.string().nullable(),
    phoneE164: z.string().nullable(),
    isKnownContact: z.boolean(),
  }),
  content: z.object({
    text: z.string().nullable(),
    languageDetected: z.enum(['de', 'en']).nullable(),
    formalityDetected: z.enum(['du', 'sie', 'unknown']),
    quotedReplyTo: z.string().nullable(),
    interactive: z
      .object({ type: z.string().min(1), payload: z.string() })
      .nullable(),
  }),
  attachments: z.array(attachmentSchema),
  rawPayloadRef: z.string().nullable(),
  idempotencyKey: z.string().min(1),
})

/**
 * Parse an untrusted value into an envelope.
 *
 * Throws on malformed input rather than returning a partial. A half-parsed
 * envelope entering the pipeline is worse than a rejected one: it would surface
 * later as a quote missing a field nobody can trace.
 */
export function parseInboundEvent(value: unknown): InboundEvent {
  return inboundEventSchema.parse(value) as InboundEvent
}

export function safeParseInboundEvent(
  value: unknown,
): { ok: true; event: InboundEvent } | { ok: false; issues: string[] } {
  const result = inboundEventSchema.safeParse(value)
  if (result.success) return { ok: true, event: result.data as InboundEvent }
  return {
    ok: false,
    issues: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  }
}

/**
 * The idempotency key: `channel:messageId`.
 *
 * Scoped by channel because message ids are only unique within their own channel —
 * a Gmail `Message-ID` and a hosted-chat turn id share no namespace, and nothing
 * stops them from colliding. Not scoped by agency, deliberately: the same physical
 * message must never be admitted twice even if a routing bug attributed it to two
 * tenants. Duplicate suppression is the point.
 */
export function idempotencyKey(channel: InboundChannel, messageId: string): string {
  return `${channel}:${messageId}`
}

/**
 * F1.1 — replaying an event creates no second inquiry.
 *
 * Modelled as a pure decision over keys already seen, so the rule is testable
 * without a database. The storage layer enforces the same thing independently via
 * the unique index on `messages.external_message_id`: application logic that can be
 * bypassed is a suggestion, and a webhook that fires twice must be a no-op even if
 * this function is never called.
 */
export function isDuplicate(event: InboundEvent, seenKeys: ReadonlySet<string>): boolean {
  return seenKeys.has(event.idempotencyKey)
}
