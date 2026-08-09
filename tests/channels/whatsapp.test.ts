/**
 * The WhatsApp adapter, and the copy that goes with it.
 *
 * The two mitigations are enforced in SQL, so their tests are in
 * db/tests/tenancy.sql — a mitigation checked only in TypeScript is a mitigation
 * that any future call site can route around. What is tested here is the adapter
 * contract, which is the claim the whole channel layer rests on: adding a channel
 * changes nothing downstream.
 */

import { describe, expect, it } from 'vitest'

import {
  providerTime,
  whatsappUnipileAdapter,
} from '../../src/channels/adapters/whatsapp-unipile'
import { safeParseInboundEvent } from '../../src/channels/envelope'
import {
  ownerNotification,
  prefilledFirstMessage,
  waMeLink,
} from '../../src/channels/whatsapp/notify'
import type { SummaryRow } from '../../src/requests/summary'

const CONTEXT = {
  agencyId: 'agency-1',
  now: '2026-08-09T15:00:00.000Z',
  newId: () => 'evt-1',
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    messageId: 'wamid.abc123',
    chatId: 'chat-9',
    fromPhone: '+4915199887766',
    fromName: 'Sarah Brandt',
    text: 'Hallo, wir heiraten am 12. Juni, 80 Gäste.',
    sentAt: '2026-08-09T14:59:30.000Z',
    ...overrides,
  }
}

describe('the adapter contract', () => {
  it('emits an envelope that validates against the canonical schema', () => {
    // The claim the channel layer rests on. A channel we did not design the
    // envelope around still produces the same shape, or the Phase 12 exit
    // criterion — "additive, zero downstream changes" — was never true.
    const event = whatsappUnipileAdapter.toInboundEvent(payload(), CONTEXT)
    const parsed = safeParseInboundEvent(event)
    expect(parsed.ok, parsed.ok ? '' : parsed.issues.join('; ')).toBe(true)
  })

  it('is pure — same payload and context, same envelope', () => {
    const a = whatsappUnipileAdapter.toInboundEvent(payload(), CONTEXT)
    const b = whatsappUnipileAdapter.toInboundEvent(payload(), CONTEXT)
    expect(a).toEqual(b)
  })

  it('takes the tenant from the context, never from the payload', () => {
    // The registry throws if an adapter emits a tenant it was not given. This is
    // the attack the check exists for: a webhook body naming another agency.
    const event = whatsappUnipileAdapter.toInboundEvent(
      payload({ agencyId: 'someone-elses-agency' }),
      CONTEXT,
    )
    expect(event.agencyId).toBe('agency-1')
  })

  it('keys idempotency on the provider message id', () => {
    // Webhooks retry. Two deliveries of one message must be one message.
    const event = whatsappUnipileAdapter.toInboundEvent(payload(), CONTEXT)
    expect(event.idempotencyKey).toBe('whatsapp:wamid.abc123')
  })

  it('scopes that key by channel, so ids from two channels cannot collide', () => {
    const event = whatsappUnipileAdapter.toInboundEvent(payload(), CONTEXT)
    expect(event.idempotencyKey.startsWith('whatsapp:')).toBe(true)
  })

  it('carries the phone and leaves email null', () => {
    const event = whatsappUnipileAdapter.toInboundEvent(payload(), CONTEXT)
    expect(event.sender.phoneE164).toBe('+4915199887766')
    expect(event.sender.email).toBeNull()
  })

  it('detects language and formality like every other channel', () => {
    const event = whatsappUnipileAdapter.toInboundEvent(payload(), CONTEXT)
    expect(event.content.languageDetected).toBe('de')
  })

  it('survives a message with no text at all', () => {
    // A voice note or a photo with no caption. Dropping it would lose a turn the
    // customer believes she sent.
    const event = whatsappUnipileAdapter.toInboundEvent(
      payload({ text: null, hasVoiceNote: true }),
      CONTEXT,
    )
    expect(event.content.text).toBeNull()
    expect(safeParseInboundEvent(event).ok).toBe(true)
  })
})

describe('the provider’s clock', () => {
  it('is used when it is plausible', () => {
    expect(providerTime('2026-08-09T14:59:30.000Z', CONTEXT.now)).toBe(
      '2026-08-09T14:59:30.000Z',
    )
  })

  it('accepts epoch millis, because Unipile sends both shapes', () => {
    const ms = Date.parse('2026-08-09T14:59:30.000Z')
    expect(providerTime(ms, CONTEXT.now)).toBe('2026-08-09T14:59:30.000Z')
  })

  it('is replaced when it claims the future', () => {
    expect(providerTime('2027-01-01T00:00:00.000Z', CONTEXT.now)).toBe(CONTEXT.now)
  })

  it('allows a day of backlog, because phones genuinely reconnect', () => {
    const yesterday = '2026-08-08T20:00:00.000Z'
    expect(providerTime(yesterday, CONTEXT.now)).toBe(yesterday)
  })

  it('is replaced when it is absent or nonsense', () => {
    expect(providerTime(null, CONTEXT.now)).toBe(CONTEXT.now)
    expect(providerTime('not a date', CONTEXT.now)).toBe(CONTEXT.now)
  })
})

describe('what the caterer sees on his phone', () => {
  const rows: SummaryRow[] = [
    { field: 'eventDate', label: 'Datum', value: '12. Juni 2027' },
    { field: 'headcount', label: 'Personen', value: '80' },
    { field: 'venue', label: 'Ort', value: 'Schloss Bensberg' },
    { field: 'serviceStyle', label: 'Service', value: 'Buffet' },
    { field: 'budgetIndication', label: 'Budget (ihre Angabe)', value: '6.000 EUR' },
  ]

  it('leads with who and what, not with a link', () => {
    const { text } = ownerNotification({
      contact: { name: 'Sarah Brandt' },
      rows,
      url: 'https://example.invalid/r/tok',
    })
    const lines = text.split('\n')
    expect(lines[0]).toContain('Sarah Brandt')
    expect(lines[1]).toContain('80')
    expect(lines[1]).toContain('Schloss Bensberg')
    expect(lines[0]).not.toContain('http')
  })

  it('carries no figure, even though his page has one', () => {
    // A preview renders on a lock screen. A number glanced at in a hallway is a
    // number without its context, and he half-remembers having agreed to it.
    const { text } = ownerNotification({
      contact: { name: 'Sarah Brandt' },
      rows,
      url: 'https://example.invalid/r/tok',
    })
    expect(text).not.toContain('6.000')
    expect(text).not.toContain('EUR')
    expect(text).not.toContain('€')
  })

  it('tells him he can just reply', () => {
    const { text } = ownerNotification({
      contact: null,
      rows,
      url: 'https://example.invalid/r/tok',
    })
    expect(text).toMatch(/Antworten Sie einfach hier/)
  })

  it('works when she never gave a name', () => {
    const { text } = ownerNotification({
      contact: null,
      rows: [],
      url: 'https://example.invalid/r/tok',
    })
    expect(text).toContain('Neue Anfrage')
    expect(text).toContain('https://example.invalid/r/tok')
  })
})

describe('the wa.me link — mitigation 1 on the customer’s side', () => {
  it('strips everything wa.me rejects from the number', () => {
    // `+`, spaces and dashes make wa.me open a "not on WhatsApp" page rather than
    // error, so the failure would be silent and blamed on the customer's phone.
    expect(waMeLink('+49 151 998 877-66', 'Hallo')).toContain('wa.me/4915199887766')
  })

  it('prefills a first message, because she has to open the thread', () => {
    const link = waMeLink('+4915199887766', prefilledFirstMessage('Kraut & Rüben', 'REQ-14'))
    expect(link).toContain('text=')
    expect(decodeURIComponent(link)).toContain('Kraut & Rüben')
    expect(decodeURIComponent(link)).toContain('REQ-14')
  })

  it('writes that message in her voice, short enough that she will not delete it', () => {
    const message = prefilledFirstMessage('Kraut & Rüben', null)
    expect(message.length).toBeLessThan(120)
    expect(message).toMatch(/^Hallo/)
  })

  it('escapes the message so the link cannot be broken by an agency name', () => {
    const link = waMeLink('+4915199887766', prefilledFirstMessage('Meier & Söhne #1', null))
    expect(link).not.toContain('#1')
    expect(decodeURIComponent(link)).toContain('#1')
  })
})
