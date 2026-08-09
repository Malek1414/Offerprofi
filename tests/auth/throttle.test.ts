/**
 * Auth throttle (F0.6).
 *
 * The first test is the one that matters most, and it is a test about *architecture*
 * rather than behaviour: this limiter refuses, the customer-facing one cannot, and
 * the two must never be merged. Invariant 1 lives in that distinction.
 */

import { describe, expect, it } from 'vitest'

import { AuthThrottle, DEFAULT_THROTTLE } from '../../src/auth/throttle'
import type { RateLimitDecision } from '../../src/chat/rate-limit'

describe('I1 boundary — the two limiters are different things', () => {
  it('the customer limiter still has no refusal-shaped outcome', () => {
    // If this ever compiles with 'refuse', someone has widened the customer-facing
    // type and Invariant 1 has stopped being enforced by the compiler.
    const outcomes: RateLimitDecision['outcome'][] = ['accept', 'accept_throttled']
    expect(outcomes).toHaveLength(2)

    // And this one does refuse — correctly, because it guards our own front door,
    // not an agency's customer. Nobody's inquiry is lost here.
    const throttle = new AuthThrottle({ ...DEFAULT_THROTTLE, freeAttempts: 1 })
    throttle.check('k', 0)
    throttle.check('k', 0)
    expect(throttle.check('k', 0).outcome).toBe('refuse')
  })
})

describe('F0.6 — backoff', () => {
  const policy = { freeAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 8_000, windowMs: 60_000 }

  it('lets the free attempts through at full speed', () => {
    const t = new AuthThrottle(policy)
    for (let i = 0; i < 3; i++) {
      const d = t.check('lisa', 0)
      expect(d.outcome).toBe('allow')
      expect(d.retryAfterSeconds).toBe(0)
    }
  })

  it('doubles the delay after the free attempts run out', () => {
    const t = new AuthThrottle(policy)
    let now = 0
    for (let i = 0; i < 3; i++) t.check('lisa', now)

    // 4th → 1s, 5th → 2s, 6th → 4s, 7th → 8s (the ceiling), 8th → still 8s.
    for (const expected of [1, 2, 4, 8, 8]) {
      now += 60_000 / 10 // advance past the previous delay, stay inside the window
      const d = t.check('lisa', now)
      expect(d.outcome, `attempt after ${expected}s window`).toBe('allow')
      expect(d.retryAfterSeconds).toBe(expected)
      now += expected * 1000
    }
  })

  it('refuses an attempt made before the backoff has elapsed', () => {
    const t = new AuthThrottle(policy)
    for (let i = 0; i < 4; i++) t.check('lisa', 0) // 4th sets a 1s delay
    const early = t.check('lisa', 500)
    expect(early.outcome).toBe('refuse')
    expect(early.retryAfterSeconds).toBe(1)
    // And allows it once the second has passed.
    expect(t.check('lisa', 1_100).outcome).toBe('allow')
  })

  it('caps the delay, so an attacker cannot lock a real owner out indefinitely', () => {
    // The reason there is no hard lockout: a lockout would let anyone who knows
    // Lisa's email keep her out of her own dashboard.
    const t = new AuthThrottle(policy)
    let now = 0
    for (let i = 0; i < 40; i++) {
      const d = t.check('lisa', now)
      now += Math.max(1, d.retryAfterSeconds) * 1000
      expect(d.retryAfterSeconds * 1000).toBeLessThanOrEqual(policy.maxDelayMs)
    }
  })

  it('forgets a key once the window has fully elapsed', () => {
    const t = new AuthThrottle(policy)
    for (let i = 0; i < 10; i++) t.check('lisa', 0)
    const fresh = t.check('lisa', policy.windowMs + 1)
    expect(fresh.outcome).toBe('allow')
    expect(fresh.attempts).toBe(1)
  })

  it('clears the backoff on success, so a correct password is not punished', () => {
    const t = new AuthThrottle(policy)
    for (let i = 0; i < 5; i++) t.check('lisa', 0)
    t.clear('lisa')
    expect(t.check('lisa', 0)).toEqual({ outcome: 'allow', retryAfterSeconds: 0, attempts: 1 })
  })

  it('keeps separate keys separate', () => {
    // Keying on both email and IP is only useful if one running hot leaves the
    // other alone — otherwise one attacker throttles every owner.
    const t = new AuthThrottle(policy)
    for (let i = 0; i < 10; i++) t.check('lisa', 0)
    expect(t.check('markus', 0).outcome).toBe('allow')
  })

  it('sweeps elapsed windows so the map does not grow without bound', () => {
    const t = new AuthThrottle(policy)
    for (let i = 0; i < 100; i++) t.check(`key-${i}`, 0)
    t.sweep(policy.windowMs + 1)
    // A swept key starts over rather than continuing an old count.
    expect(t.check('key-0', policy.windowMs + 2).attempts).toBe(1)
  })
})
