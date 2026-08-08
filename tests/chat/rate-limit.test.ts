/**
 * F1.6 — rate limiting.
 *
 * Acceptance: "Limits are ours, tunable, and logged." Plus Invariant 1: a limiter
 * is refusal-shaped, and this one must throttle without ever refusing.
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_RATE_LIMIT,
  RateLimiter,
  throttleNotice,
} from '../../src/chat/rate-limit'

const NOW = new Date('2026-08-08T10:00:00.000Z')

describe('F1.6 — limits', () => {
  it('accepts normal conversation', () => {
    const limiter = new RateLimiter()
    for (let i = 0; i < DEFAULT_RATE_LIMIT.perSessionPerMinute; i++) {
      expect(limiter.check('sess_1', '203.0.113.1', NOW).outcome).toBe('accept')
    }
  })

  it('throttles a session past its limit', () => {
    const limiter = new RateLimiter()
    for (let i = 0; i < DEFAULT_RATE_LIMIT.perSessionPerMinute; i++) {
      limiter.check('sess_1', '203.0.113.1', NOW)
    }
    const decision = limiter.check('sess_1', '203.0.113.1', NOW)
    expect(decision.outcome).toBe('accept_throttled')
    expect(decision.scope).toBe('session')
    expect(decision.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('counts IPs separately, so one busy session does not throttle a stranger', () => {
    const limiter = new RateLimiter()
    for (let i = 0; i < DEFAULT_RATE_LIMIT.perSessionPerMinute + 5; i++) {
      limiter.check('sess_1', '203.0.113.1', NOW)
    }
    expect(limiter.check('sess_2', '203.0.113.2', NOW).outcome).toBe('accept')
  })

  it('tolerates a venue wifi NATing many customers to one address', () => {
    // The per-IP limit is well above the per-session one precisely for this.
    const limiter = new RateLimiter()
    const sharedIp = '203.0.113.9'
    for (let s = 0; s < 5; s++) {
      for (let i = 0; i < 10; i++) {
        expect(limiter.check(`sess_${s}`, sharedIp, NOW).outcome).toBe('accept')
      }
    }
  })

  it('resets after the window elapses', () => {
    const limiter = new RateLimiter()
    for (let i = 0; i < DEFAULT_RATE_LIMIT.perSessionPerMinute + 1; i++) {
      limiter.check('sess_1', null, NOW)
    }
    const nextWindow = new Date(NOW.getTime() + DEFAULT_RATE_LIMIT.windowMs + 1)
    expect(limiter.check('sess_1', null, nextWindow).outcome).toBe('accept')
  })

  it('is tunable', () => {
    const limiter = new RateLimiter({
      perSessionPerMinute: 2,
      perIpPerMinute: 100,
      windowMs: 60_000,
    })
    limiter.check('s', null, NOW)
    limiter.check('s', null, NOW)
    expect(limiter.check('s', null, NOW).outcome).toBe('accept_throttled')
  })

  it('logs every throttle and nothing else', () => {
    const limiter = new RateLimiter({ perSessionPerMinute: 1, perIpPerMinute: 99, windowMs: 60_000 })
    expect(limiter.check('s', null, NOW).logLine).toBeNull()
    const throttled = limiter.check('s', null, NOW)
    expect(throttled.logLine).toContain('rate_limit')
    expect(throttled.logLine).toContain('outcome=accept_throttled')
  })

  it('sweeps elapsed windows so the map does not grow without bound', () => {
    const limiter = new RateLimiter()
    for (let i = 0; i < 100; i++) limiter.check(`sess_${i}`, null, NOW)
    limiter.sweep(new Date(NOW.getTime() + DEFAULT_RATE_LIMIT.windowMs + 1))
    // After a sweep the first turn of a swept session starts a fresh window.
    expect(limiter.check('sess_0', null, NOW).used).toBe(1)
  })
})

describe('F1.6 — Invariant 1: a limiter must not become a refusal', () => {
  it('has no outcome that rejects, drops or blocks a customer', () => {
    const limiter = new RateLimiter({ perSessionPerMinute: 1, perIpPerMinute: 1, windowMs: 60_000 })
    const outcomes = new Set<string>()
    for (let i = 0; i < 50; i++) {
      outcomes.add(limiter.check('sess_1', '203.0.113.1', NOW).outcome)
    }
    // Whatever a customer does, the message is accepted. Only the reply is delayed.
    expect([...outcomes].every((o) => o.startsWith('accept'))).toBe(true)
    expect(outcomes.has('reject')).toBe(false)
  })

  it('tells a throttled customer we have their messages, without reproach', () => {
    // She typed fast because she is excited. That is not misconduct, and a
    // telling-off from a business she may spend five figures with is expensive.
    for (const notice of [
      throttleNotice('de', 'du'),
      throttleNotice('de', 'sie'),
      throttleNotice('en', 'sie'),
    ]) {
      expect(notice.toLowerCase()).not.toMatch(/zu viele|too many|slow down|langsamer/)
      expect(notice.length).toBeGreaterThan(20)
    }
  })
})
