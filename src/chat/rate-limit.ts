/**
 * Rate limiting for the message endpoint (F1.6).
 *
 * Acceptance: "Limits are ours, tunable, and logged."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INVARIANT 1 APPLIES HERE, and it is easy to miss.
 *
 * A rate limiter is refusal-shaped. The obvious implementation returns 429 and
 * drops the message, which for a customer mid-inquiry is indistinguishable from
 * being turned away — precisely what §2.1 forbids.
 *
 * So this limiter **throttles, it never rejects**. Exceeding a limit slows the
 * *agent's replies*; it never discards the customer's message and never closes the
 * inquiry. The message is always accepted and stored. There is no outcome here that
 * ends a conversation, and `RateLimitDecision` has no variant that could express
 * one.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A fixed window rather than a token bucket: the numbers stay legible to a
 * non-technical owner reading a log line, and a burst at a window boundary is not a
 * meaningful threat when the outcome is only a short delay.
 */

/** Tunable per deployment; these are starting points, not physics. */
export interface RateLimitPolicy {
  /** Messages per window from one session. Generous — people type in fragments. */
  perSessionPerMinute: number
  /** Per IP. Higher, because a venue's guest wifi NATs many people to one address. */
  perIpPerMinute: number
  windowMs: number
}

export const DEFAULT_RATE_LIMIT: RateLimitPolicy = {
  perSessionPerMinute: 20,
  perIpPerMinute: 60,
  windowMs: 60_000,
}

export type RateLimitScope = 'session' | 'ip'

export interface RateLimitDecision {
  /**
   * `accept` — handle the turn normally.
   * `accept_throttled` — **still accept and store the message**, but delay the
   * agent's reply and tell the customer we are keeping up. Not a refusal.
   *
   * Note what is not here: no `reject`, no `drop`, no `block`.
   */
  outcome: 'accept' | 'accept_throttled'
  scope: RateLimitScope | null
  /** Seconds until the window resets. Surfaced to the customer as reassurance. */
  retryAfterSeconds: number
  limit: number
  used: number
  /** F1.6 — every throttle is logged. Our limits, visible, tunable. */
  logLine: string | null
}

export interface CounterState {
  count: number
  windowStartedAt: number
}

/** Mutable counters, keyed `scope:id`. Swap for Redis when there are two instances. */
export class RateLimiter {
  private readonly counters = new Map<string, CounterState>()
  private readonly policy: RateLimitPolicy

  constructor(policy: RateLimitPolicy = DEFAULT_RATE_LIMIT) {
    this.policy = policy
  }

  /**
   * Record a turn and decide how to treat it.
   *
   * Both scopes are always counted, even when the first one already throttles, so
   * the counters stay accurate rather than reflecting only whichever check ran
   * first.
   */
  check(sessionId: string, ip: string | null, now: Date): RateLimitDecision {
    const sessionState = this.bump(`session:${sessionId}`, now)
    const ipState = ip ? this.bump(`ip:${ip}`, now) : null

    const sessionOver = sessionState.count > this.policy.perSessionPerMinute
    const ipOver = ipState !== null && ipState.count > this.policy.perIpPerMinute

    if (!sessionOver && !ipOver) {
      return {
        outcome: 'accept',
        scope: null,
        retryAfterSeconds: 0,
        limit: this.policy.perSessionPerMinute,
        used: sessionState.count,
        logLine: null,
      }
    }

    const scope: RateLimitScope = sessionOver ? 'session' : 'ip'
    const state = sessionOver ? sessionState : (ipState as CounterState)
    const limit = sessionOver ? this.policy.perSessionPerMinute : this.policy.perIpPerMinute
    const elapsed = now.getTime() - state.windowStartedAt
    const retryAfterSeconds = Math.max(1, Math.ceil((this.policy.windowMs - elapsed) / 1000))

    return {
      outcome: 'accept_throttled',
      scope,
      retryAfterSeconds,
      limit,
      used: state.count,
      logLine:
        `rate_limit scope=${scope} used=${state.count} limit=${limit} ` +
        `retry_after=${retryAfterSeconds}s outcome=accept_throttled`,
    }
  }

  private bump(key: string, now: Date): CounterState {
    const t = now.getTime()
    const existing = this.counters.get(key)
    if (!existing || t - existing.windowStartedAt >= this.policy.windowMs) {
      const fresh: CounterState = { count: 1, windowStartedAt: t }
      this.counters.set(key, fresh)
      return fresh
    }
    existing.count += 1
    return existing
  }

  /** Drop windows that have fully elapsed. Called on a timer; unbounded maps leak. */
  sweep(now: Date): void {
    for (const [key, state] of this.counters) {
      if (now.getTime() - state.windowStartedAt >= this.policy.windowMs) {
        this.counters.delete(key)
      }
    }
  }
}

/**
 * What a throttled customer is told.
 *
 * Written as reassurance, never as reproach. The customer has done nothing wrong —
 * from their side they typed quickly, which is what an excited bride does. Any
 * wording resembling "you are sending too many messages" would read as a telling-off
 * from a business she is about to spend five figures with.
 */
export function throttleNotice(language: 'de' | 'en', formality: 'du' | 'sie'): string {
  if (language === 'de') {
    return formality === 'du'
      ? 'Ich habe alles bekommen und arbeite die Nachrichten gerade der Reihe nach ab — einen Moment.'
      : 'Ich habe alles erhalten und arbeite die Nachrichten gerade der Reihe nach ab — einen Moment.'
  }
  return "I've got all of that and I'm working through your messages — one moment."
}
