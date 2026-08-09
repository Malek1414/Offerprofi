import { describe, expect, it } from 'vitest'

import {
  costCentsColumn,
  costMicroCents,
  isKnownModel,
  supportsZeroRetention,
} from '../../src/agent/cost'

describe('costMicroCents', () => {
  it('prices Opus 5 at list — $5 in, $25 out per million tokens', () => {
    // 1M input = 500¢ = 500_000_000 µ¢. 1M output = 2500¢.
    expect(costMicroCents('claude-opus-5', { inputTokens: 1_000_000, outputTokens: 0 })).toBe(
      500_000_000,
    )
    expect(costMicroCents('claude-opus-5', { inputTokens: 0, outputTokens: 1_000_000 })).toBe(
      2_500_000_000,
    )
  })

  it('bills cache reads at a tenth and cache writes at 1.25x of input', () => {
    expect(
      costMicroCents('claude-opus-5', {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
      }),
    ).toBe(50_000_000)
    expect(
      costMicroCents('claude-opus-5', {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 1_000_000,
      }),
    ).toBe(625_000_000)
  })

  it('stays an exact integer at the scale of a single realistic call', () => {
    // The shape of one extraction: a short conversation in, a small JSON out.
    const cost = costMicroCents('claude-opus-5', { inputTokens: 1_843, outputTokens: 412 })
    expect(cost).toBe(1_843 * 500 + 412 * 2_500)
    expect(Number.isInteger(cost)).toBe(true)
  })

  it('does not accumulate float error over ten thousand calls', () => {
    // The reason the rates are integer micro-cents rather than fractional cents.
    // Summed as 0.0005-cent floats this drifts; as integers it cannot.
    let total = 0
    for (let i = 0; i < 10_000; i += 1) {
      total += costMicroCents('claude-opus-5', { inputTokens: 1_843, outputTokens: 412 })!
    }
    expect(total).toBe(10_000 * (1_843 * 500 + 412 * 2_500))
  })

  it('prices the cheaper models from the same table', () => {
    expect(costMicroCents('claude-sonnet-5', { inputTokens: 1_000_000, outputTokens: 0 })).toBe(
      300_000_000,
    )
    expect(costMicroCents('claude-haiku-4-5', { inputTokens: 1_000_000, outputTokens: 0 })).toBe(
      100_000_000,
    )
  })

  it('is zero for a call that used no tokens', () => {
    expect(costMicroCents('claude-opus-5', { inputTokens: 0, outputTokens: 0 })).toBe(0)
  })

  it('returns null for an unknown model rather than guessing a rate', () => {
    // A missing cost is honest. An invented one silently corrupts the only figure
    // the €19–49 pricing hypothesis will ever be checked against.
    expect(costMicroCents('claude-something-new', { inputTokens: 100, outputTokens: 10 })).toBeNull()
  })
})

describe('costCentsColumn', () => {
  it('renders micro-cents as an exact decimal string for the numeric column', () => {
    expect(costCentsColumn(1_500_000)).toBe('1.500000')
    expect(costCentsColumn(1)).toBe('0.000001')
    expect(costCentsColumn(0)).toBe('0.000000')
  })

  it('renders a realistic call without going through a float', () => {
    const cost = costMicroCents('claude-opus-5', { inputTokens: 1_843, outputTokens: 412 })
    // 921_500 + 1_030_000 = 1_951_500 µ¢ = 1.9515¢
    expect(costCentsColumn(cost)).toBe('1.951500')
  })

  it('passes null through, so an unpriced model writes null rather than zero', () => {
    expect(costCentsColumn(null)).toBeNull()
  })
})

describe('model registry', () => {
  it('recognises the models this product may use', () => {
    expect(isKnownModel('claude-opus-5')).toBe(true)
    expect(isKnownModel('claude-fable-5')).toBe(false)
  })

  it('only lists models eligible for zero data retention (D17)', () => {
    for (const model of ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'] as const) {
      expect(supportsZeroRetention(model)).toBe(true)
    }
  })
})
