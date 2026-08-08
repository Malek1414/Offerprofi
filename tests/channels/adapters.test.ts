/**
 * F1.2 / F1.3 — adapter contract, registry, and the hosted-chat adapter.
 *
 * Acceptance: "Adapter is a pure function channelPayload → InboundEvent" and
 * "Every chat turn emits an envelope with channel: 'hosted_chat'".
 *
 * These tests stand in for the Phase 12 exit criterion. When the WhatsApp adapter
 * is written it must satisfy exactly this contract and change nothing downstream.
 */

import { describe, expect, it } from 'vitest'

import { AdapterRegistry, type AdapterContext, defineAdapter } from '../../src/channels/registry'
import { idempotencyKey, inboundEventSchema } from '../../src/channels/envelope'
import {
  hostedChatAdapter,
  type HostedChatPayload,
} from '../../src/channels/adapters/hosted-chat'

const NOW = '2026-08-08T10:14:03.000Z'

function context(overrides: Partial<AdapterContext> = {}): AdapterContext {
  let n = 0
  return {
    agencyId: 'agency_1',
    now: NOW,
    newId: () => `evt_${++n}`,
    ...overrides,
  }
}

function payload(overrides: Partial<HostedChatPayload> = {}): HostedChatPayload {
  return {
    turnId: 'turn_1',
    sessionId: 'sess_1',
    text: 'Hallo, wir heiraten am 12.09.2027 und suchen Unterstützung.',
    ...overrides,
  }
}

describe('F1.3 — hosted-chat adapter', () => {
  it('emits a valid envelope on channel hosted_chat', () => {
    const event = hostedChatAdapter.toInboundEvent(payload(), context())

    expect(event.channel).toBe('hosted_chat')
    expect(event.direction).toBe('inbound')
    expect(() => inboundEventSchema.parse(event)).not.toThrow()
  })

  it('is pure — same payload and context, identical envelope', () => {
    const p = payload()
    const a = hostedChatAdapter.toInboundEvent(p, context())
    const b = hostedChatAdapter.toInboundEvent(p, context())
    expect(a).toEqual(b)
  })

  it('takes the tenant from the context, never from the payload', () => {
    // F1.4 — a client that tries to name a tenant is ignored, not obeyed.
    const hostile = { ...payload(), agencyId: 'agency_victim' } as HostedChatPayload
    const event = hostedChatAdapter.toInboundEvent(hostile, context({ agencyId: 'agency_1' }))
    expect(event.agencyId).toBe('agency_1')
  })

  it('derives the idempotency key from the turn id', () => {
    const event = hostedChatAdapter.toInboundEvent(payload({ turnId: 'turn_9' }), context())
    expect(event.idempotencyKey).toBe(idempotencyKey('hosted_chat', 'turn_9'))
  })

  it('detects German and mirrors it onto the envelope', () => {
    const event = hostedChatAdapter.toInboundEvent(payload(), context())
    expect(event.content.languageDetected).toBe('de')
  })

  it('always stamps receivedAt from the server clock', () => {
    const event = hostedChatAdapter.toInboundEvent(
      payload({ clientSentAt: '2019-01-01T00:00:00.000Z' }),
      context(),
    )
    expect(event.receivedAt).toBe(NOW)
  })

  it('ignores a client clock that is implausibly far ahead', () => {
    // A browser reporting next week must not jump the queue or poison SLA timers.
    const event = hostedChatAdapter.toInboundEvent(
      payload({ clientSentAt: '2026-08-15T10:14:03.000Z' }),
      context(),
    )
    expect(event.occurredAt).toBe(NOW)
  })

  it('honours a client clock inside the offline-backlog window', () => {
    // A phone that composed in a venue basement and sent on reconnect keeps its
    // own ordering.
    const tenMinutesAgo = '2026-08-08T10:04:03.000Z'
    const event = hostedChatAdapter.toInboundEvent(
      payload({ clientSentAt: tenMinutesAgo }),
      context(),
    )
    expect(event.occurredAt).toBe(tenMinutesAgo)
    expect(event.receivedAt).toBe(NOW)
  })

  it('carries an interactive chip reply through unchanged', () => {
    const event = hostedChatAdapter.toInboundEvent(
      payload({ text: '', interactive: { type: 'chip_reply', payload: 'guests_50_100' } }),
      context(),
    )
    expect(event.content.interactive).toEqual({
      type: 'chip_reply',
      payload: 'guests_50_100',
    })
  })
})

describe('F1.2 — adapter contract enforcement', () => {
  it('rejects an adapter that emits the wrong channel', () => {
    // The copy-paste bug: a new adapter built from an old one, still naming the
    // channel it was copied from. It would route silently wrong.
    const wrong = defineAdapter<HostedChatPayload>('whatsapp', (p, ctx) => ({
      ...hostedChatAdapter.toInboundEvent(p, ctx),
    }))
    expect(() => wrong.toInboundEvent(payload(), context())).toThrow(/emitted an envelope/)
  })

  it('rejects an adapter that invents a tenant', () => {
    const leaky = defineAdapter<HostedChatPayload>('hosted_chat', (p, ctx) => ({
      ...hostedChatAdapter.toInboundEvent(p, ctx),
      agencyId: 'agency_somewhere_else',
    }))
    expect(() => leaky.toInboundEvent(payload(), context())).toThrow(/tenant/)
  })

  it('rejects an adapter with a non-canonical idempotency key', () => {
    const sloppy = defineAdapter<HostedChatPayload>('hosted_chat', (p, ctx) => ({
      ...hostedChatAdapter.toInboundEvent(p, ctx),
      idempotencyKey: 'whatever',
    }))
    expect(() => sloppy.toInboundEvent(payload(), context())).toThrow(/idempotency/)
  })
})

describe('F1.2 — registry', () => {
  it('resolves a registered adapter', () => {
    const registry = new AdapterRegistry().register(hostedChatAdapter)
    expect(registry.get('hosted_chat')).toBe(hostedChatAdapter)
    expect(registry.has('hosted_chat')).toBe(true)
  })

  it('refuses a duplicate registration rather than silently replacing one', () => {
    const registry = new AdapterRegistry().register(hostedChatAdapter)
    expect(() => registry.register(hostedChatAdapter)).toThrow(/already registered/)
  })

  it('throws for a channel with no adapter yet', () => {
    const registry = new AdapterRegistry().register(hostedChatAdapter)
    expect(() => registry.get('whatsapp')).toThrow(/no adapter/)
  })

  it('adding a channel is additive — existing adapters are untouched', () => {
    // The X1 claim, in miniature: registering a second channel changes nothing
    // about how the first one behaves.
    const registry = new AdapterRegistry().register(hostedChatAdapter)
    const before = registry.get('hosted_chat').toInboundEvent(payload(), context())

    const stub = defineAdapter<HostedChatPayload>('paste_in', (p, ctx) => ({
      ...hostedChatAdapter.toInboundEvent(p, ctx),
      channel: 'paste_in' as const,
      idempotencyKey: idempotencyKey('paste_in', p.turnId),
    }))
    registry.register(stub)

    const after = registry.get('hosted_chat').toInboundEvent(payload(), context())
    expect(after).toEqual(before)
    expect(registry.registered()).toEqual(['hosted_chat', 'paste_in'])
  })
})
