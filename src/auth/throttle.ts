/**
 * Refusing limiter for the owner-side auth endpoints (F0.6).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT `src/chat/rate-limit.ts`.
 *
 * That limiter's `RateLimitDecision` deliberately has no variant that can express a
 * refusal — it is Invariant 1 written as a type, and reusing it here and then
 * treating "throttled" as "rejected" would quietly turn its guarantee into a
 * convention. Worse, the next person to read it would find a refusal-shaped call
 * site and reasonably conclude the type permits one.
 *
 * This limiter *does* refuse, and that is correct, because Invariant 1 is about the
 * agency's **customers**: no code path may turn away a bride asking for a quote.
 * Signup and login are our own front door, hit by anonymous strangers, and a login
 * form with no lockout is a credential-stuffing target. Nobody's inquiry is lost
 * when a signup attempt is slowed down.
 *
 * The two limiters are separate files with separate types so that the distinction
 * survives a refactor by someone who has not read this comment.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Exponential backoff rather than a hard lockout. A lockout is itself an attack: if
 * five bad guesses lock an account for an hour, anyone who knows Lisa's email can
 * keep her out of her own dashboard on the morning she needs it. Backoff makes
 * guessing infeasible while leaving the real owner a way in — she waits seconds, an
 * attacker needs centuries.
 */

export interface ThrottlePolicy {
  /** Attempts allowed at full speed before backoff starts. */
  freeAttempts: number
  /** First delay after the free attempts run out. Doubles from there. */
  baseDelayMs: number
  /** Ceiling, so a determined attacker cannot push a real owner past it. */
  maxDelayMs: number
  /** Counters older than this are forgotten. */
  windowMs: number
}

export const DEFAULT_THROTTLE: ThrottlePolicy = {
  freeAttempts: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  windowMs: 15 * 60_000,
}

export interface ThrottleDecision {
  /** `allow` — proceed. `refuse` — return 429 without doing the work. */
  outcome: 'allow' | 'refuse'
  /** How long the caller should wait before the next attempt, in seconds. */
  retryAfterSeconds: number
  attempts: number
}

interface Counter {
  attempts: number
  firstAt: number
  /** When the next attempt becomes permissible. */
  nextAllowedAt: number
}

export class AuthThrottle {
  private readonly counters = new Map<string, Counter>()
  private readonly policy: ThrottlePolicy

  constructor(policy: ThrottlePolicy = DEFAULT_THROTTLE) {
    this.policy = policy
  }

  /**
   * Record an attempt and decide whether to serve it.
   *
   * Called *before* the expensive work, so a refused attempt costs no scrypt — which
   * is the point on an endpoint whose whole cost is one deliberate 100ms hash.
   */
  check(key: string, now: number = Date.now()): ThrottleDecision {
    const existing = this.counters.get(key)

    if (!existing || now - existing.firstAt >= this.policy.windowMs) {
      this.counters.set(key, { attempts: 1, firstAt: now, nextAllowedAt: now })
      return { outcome: 'allow', retryAfterSeconds: 0, attempts: 1 }
    }

    if (now < existing.nextAllowedAt) {
      return {
        outcome: 'refuse',
        retryAfterSeconds: Math.max(1, Math.ceil((existing.nextAllowedAt - now) / 1000)),
        attempts: existing.attempts,
      }
    }

    existing.attempts += 1

    if (existing.attempts <= this.policy.freeAttempts) {
      existing.nextAllowedAt = now
      return { outcome: 'allow', retryAfterSeconds: 0, attempts: existing.attempts }
    }

    const over = existing.attempts - this.policy.freeAttempts
    const delay = Math.min(
      this.policy.maxDelayMs,
      this.policy.baseDelayMs * 2 ** Math.min(over - 1, 20),
    )
    existing.nextAllowedAt = now + delay

    return {
      outcome: 'allow',
      retryAfterSeconds: Math.ceil(delay / 1000),
      attempts: existing.attempts,
    }
  }

  /**
   * Forget a key after a successful login.
   *
   * Without this, an owner who mistypes her password four times and then gets it
   * right stays in backoff for the rest of the window — punished for having
   * succeeded.
   */
  clear(key: string): void {
    this.counters.delete(key)
  }

  /** Drop elapsed windows. Called on a timer; an unbounded map is a slow leak. */
  sweep(now: number = Date.now()): void {
    for (const [key, counter] of this.counters) {
      if (now - counter.firstAt >= this.policy.windowMs) this.counters.delete(key)
    }
  }
}
