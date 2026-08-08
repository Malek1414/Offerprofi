/**
 * F1.1 — the canonical envelope.
 *
 * Acceptance: "Replaying an event creates no second inquiry."
 */

import { describe, expect, it } from 'vitest'

import {
  INBOUND_CHANNELS,
  type InboundEvent,
  idempotencyKey,
  isDuplicate,
  parseInboundEvent,
  safeParseInboundEvent,
} from '../../src/channels/envelope'

function validEvent(overrides: Partial<InboundEvent> = {}): InboundEvent {
  return {
    eventId: 'evt_1',
    agencyId: 'agency_1',
    channel: 'hosted_chat',
    direction: 'inbound',
    externalIds: { messageId: 'turn_1', threadId: 'sess_1' },
    occurredAt: '2026-08-08T10:14:02.000Z',
    receivedAt: '2026-08-08T10:14:03.000Z',
    sender: {
      displayName: 'Lisa Meier',
      email: 'lisa@example.com',
      phoneE164: null,
      isKnownContact: false,
    },
    content: {
      text: 'Hallo, wir heiraten am 12.09.2027',
      languageDetected: 'de',
      formalityDetected: 'unknown',
      quotedReplyTo: null,
      interactive: null,
    },
    attachments: [],
    rawPayloadRef: null,
    idempotencyKey: 'hosted_chat:turn_1',
    ...overrides,
  }
}

describe('F1.1 — envelope schema', () => {
  it('accepts a well-formed envelope', () => {
    expect(() => parseInboundEvent(validEvent())).not.toThrow()
  })

  it('rejects an unknown channel', () => {
    const result = safeParseInboundEvent(validEvent({ channel: 'carrier_pigeon' as never }))
    expect(result.ok).toBe(false)
  })

  it('rejects an outbound direction — this envelope is inbound only', () => {
    const result = safeParseInboundEvent(validEvent({ direction: 'outbound' as never }))
    expect(result.ok).toBe(false)
  })

  it('rejects a malformed sha256 on an attachment', () => {
    const result = safeParseInboundEvent(
      validEvent({
        attachments: [
          {
            attachmentId: 'att_1',
            kind: 'document',
            mime: 'application/pdf',
            filename: 'Briefing.pdf',
            bytes: 184320,
            sha256: 'not-a-hash',
            storagePath: 'tenant/1/inbound/att_1',
            scanStatus: 'pending',
          },
        ],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.join()).toMatch(/sha256/)
  })

  it('rejects an unparseable timestamp', () => {
    const result = safeParseInboundEvent(validEvent({ occurredAt: 'letzten Dienstag' }))
    expect(result.ok).toBe(false)
  })

  it('reports every issue rather than only the first', () => {
    const result = safeParseInboundEvent({ eventId: 'evt_1' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.length).toBeGreaterThan(1)
  })

  it('does not admit slack as an inbound channel — it is an owner-side surface', () => {
    // CLAUDE.md §4: Slack is never a customer intake channel. The database enum
    // includes it for outbound; this list must not.
    expect(INBOUND_CHANNELS).not.toContain('slack' as never)
  })
})

describe('F1.1 — idempotency', () => {
  it('scopes the key by channel, because message ids share no namespace', () => {
    expect(idempotencyKey('email', 'abc')).not.toBe(idempotencyKey('whatsapp', 'abc'))
  })

  it('replaying an event is recognised as a duplicate', () => {
    const event = validEvent()
    const seen = new Set<string>()

    expect(isDuplicate(event, seen)).toBe(false)
    seen.add(event.idempotencyKey)

    // The same webhook fires again — a new eventId and a new receivedAt, but the
    // same underlying message. This must not create a second inquiry.
    const replay = validEvent({
      eventId: 'evt_2',
      receivedAt: '2026-08-08T10:20:00.000Z',
    })
    expect(isDuplicate(replay, seen)).toBe(true)
  })

  it('does not treat a genuinely different message as a duplicate', () => {
    const seen = new Set([validEvent().idempotencyKey])
    const second = validEvent({
      externalIds: { messageId: 'turn_2', threadId: 'sess_1' },
      idempotencyKey: idempotencyKey('hosted_chat', 'turn_2'),
    })
    expect(isDuplicate(second, seen)).toBe(false)
  })

  it('suppresses a duplicate even if it were attributed to another tenant', () => {
    // The key is deliberately not agency-scoped: one physical message must never
    // be admitted twice, and a routing bug must not be able to defeat that.
    const seen = new Set([validEvent().idempotencyKey])
    expect(isDuplicate(validEvent({ agencyId: 'agency_2' }), seen)).toBe(true)
  })
})
