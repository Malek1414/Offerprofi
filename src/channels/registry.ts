/**
 * Channel adapters and the registry (F1.2, constraint X1).
 *
 * **An adapter is a pure function `channelPayload → InboundEvent`.** That is the
 * entire contract, and its narrowness is the point. An adapter may not write to the
 * database, call an API, generate an id from a global counter, or read the clock —
 * everything non-deterministic arrives through `AdapterContext`, supplied by the
 * caller. Consequences:
 *
 *   - adapters are testable with no infrastructure at all;
 *   - the same payload always yields the same envelope, so replay is safe;
 *   - a new channel cannot smuggle behaviour into the pipeline, because there is
 *     nowhere in a pure function to put it.
 *
 * The exit criterion for Phase 12 is that the WhatsApp adapter lands with zero
 * downstream code changes. That is only achievable if adapters stay this thin.
 */

import {
  type InboundChannel,
  type InboundEvent,
  idempotencyKey,
  inboundEventSchema,
} from './envelope'

/**
 * Everything an adapter is not allowed to obtain for itself.
 *
 * `agencyId` in particular: it is resolved server-side from the slug (F1.4) and
 * handed to the adapter. An adapter never reads a tenant id out of the payload it
 * is parsing, because that payload is attacker-controlled and reading a tenant from
 * it is exactly how cross-tenant writes happen.
 */
export interface AdapterContext {
  agencyId: string
  /** Injected so adapters stay pure and tests can pin time. */
  now: string
  /** Injected for the same reason. In production, `crypto.randomUUID`. */
  newId: () => string
  /** True when the sender resolves to an existing `contacts` row for this tenant. */
  isKnownContact?: boolean
  /** Storage path of the archived original, when the caller has already stored it. */
  rawPayloadRef?: string | null
}

export interface ChannelAdapter<TPayload> {
  channel: InboundChannel
  /** Pure. Same payload plus same context, same envelope, always. */
  toInboundEvent: (_payload: TPayload, _context: AdapterContext) => InboundEvent
}

/**
 * Build an adapter, checking the invariants a hand-written one could get wrong.
 *
 * The wrapper asserts that the emitted envelope actually carries the adapter's own
 * channel and the context's tenant. Cheap, and it catches the copy-paste bug that
 * creating each new adapter from the previous one makes likely: a `whatsapp`
 * adapter that still says `channel: 'email'` would otherwise route silently wrong.
 */
export function defineAdapter<TPayload>(
  channel: InboundChannel,
  build: (_payload: TPayload, _context: AdapterContext) => InboundEvent,
): ChannelAdapter<TPayload> {
  return {
    channel,
    toInboundEvent(payload, context) {
      const event = build(payload, context)
      if (event.channel !== channel) {
        throw new Error(
          `adapter "${channel}" emitted an envelope for channel "${event.channel}"`,
        )
      }
      if (event.agencyId !== context.agencyId) {
        throw new Error(
          `adapter "${channel}" emitted agencyId "${event.agencyId}" but the ` +
            `resolved tenant is "${context.agencyId}" — a tenant must never come ` +
            `from a channel payload`,
        )
      }
      if (event.idempotencyKey !== idempotencyKey(channel, event.externalIds.messageId)) {
        throw new Error(`adapter "${channel}" emitted a non-canonical idempotency key`)
      }
      // Validate the shape at the boundary, where an inbound payload becomes our
      // own data. Downstream code is entitled to assume this already happened.
      inboundEventSchema.parse(event)
      return event
    },
  }
}

export class AdapterRegistry {
  /**
   * The map is heterogeneous by construction: each adapter has its own payload
   * type and only its own caller knows it. `never` is the honest element type —
   * every `ChannelAdapter<T>` is assignable to it, and nothing can be called
   * through it by accident. Type safety is restored at the `get` call site.
   */
  private readonly adapters = new Map<InboundChannel, ChannelAdapter<never>>()

  register<TPayload>(adapter: ChannelAdapter<TPayload>): this {
    if (this.adapters.has(adapter.channel)) {
      throw new Error(`adapter already registered for channel "${adapter.channel}"`)
    }
    this.adapters.set(adapter.channel, adapter)
    return this
  }

  get<TPayload>(channel: InboundChannel): ChannelAdapter<TPayload> {
    const adapter = this.adapters.get(channel)
    if (!adapter) throw new Error(`no adapter registered for channel "${channel}"`)
    return adapter as ChannelAdapter<TPayload>
  }

  has(channel: InboundChannel): boolean {
    return this.adapters.has(channel)
  }

  registered(): InboundChannel[] {
    return [...this.adapters.keys()]
  }
}
