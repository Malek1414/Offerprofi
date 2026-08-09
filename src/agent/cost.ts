/**
 * What a model call cost (F0.11, X6, open question #3).
 *
 * Pure arithmetic over a rate table, in the same spirit as the pricing engine:
 * the model never computes a number the product relies on, and every figure here
 * can be reconstructed from the token counts stored alongside it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INTEGER MICRO-CENTS, NOT FLOATING-POINT CENTS.
 *
 * A rate of $5 per million tokens is 0.0005 cents per token — a figure that does
 * not survive summing ten thousand times in a float. Every rate below is an
 * integer number of micro-cents per token, chosen so that the cache multipliers
 * (0.1× read, 1.25× write) also land on integers. The total is exact, and it is
 * rendered to a decimal string exactly once, at the database boundary.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The figures are **US cents**, because Anthropic bills in dollars. Converting to
 * euros here would bake in an FX rate nobody could reconstruct six months later,
 * and the question this column exists to answer — what does one inquiry cost —
 * is answerable in either currency as long as everyone knows which one it is.
 */

/** Micro-cents: one millionth of a US cent. */
const MICRO_CENTS_PER_CENT = 1_000_000

export type ModelId = 'claude-opus-5' | 'claude-sonnet-5' | 'claude-haiku-4-5'

interface ModelSpec {
  /** US micro-cents per input token. */
  inputRate: number
  /** US micro-cents per output token. */
  outputRate: number
  /**
   * D17 requires zero data retention where it is available. It is an account-level
   * setting rather than a request parameter, but some models are not eligible for
   * it at all, and those must never be reachable from this product — the DPA and
   * the sub-processor entry in every agency's GDPR record say otherwise.
   */
  zeroRetentionEligible: boolean
}

/**
 * List prices, August 2026. Cache read is 0.1× input and cache write 1.25× input
 * on every model, so those are derived rather than typed out three more times.
 *
 * Sonnet 5 is on introductory pricing until 2026-08-31, which makes the real bill
 * lower than what is recorded here. Encoding a rate that changes on a date would
 * make an old row impossible to explain, so this stays at list and the difference
 * shows up as the measurement being conservative.
 */
const MODELS: Record<ModelId, ModelSpec> = {
  'claude-opus-5': { inputRate: 500, outputRate: 2_500, zeroRetentionEligible: true },
  'claude-sonnet-5': { inputRate: 300, outputRate: 1_500, zeroRetentionEligible: true },
  'claude-haiku-4-5': { inputRate: 100, outputRate: 500, zeroRetentionEligible: true },
}

export function isKnownModel(model: string): model is ModelId {
  return Object.prototype.hasOwnProperty.call(MODELS, model)
}

export function supportsZeroRetention(model: ModelId): boolean {
  return MODELS[model].zeroRetentionEligible
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  /** Tokens read from a cache entry, billed at a tenth of the input rate. */
  cacheReadTokens?: number
  /** Tokens written to a cache entry, billed at 1.25× the input rate. */
  cacheWriteTokens?: number
}

/**
 * Cost of one call, in whole micro-cents.
 *
 * Returns null for a model that is not in the table rather than guessing a rate.
 * A missing cost is honest; an invented one silently corrupts the only number the
 * pricing hypothesis will ever be checked against.
 */
export function costMicroCents(model: string, usage: TokenUsage): number | null {
  if (!isKnownModel(model)) return null
  const spec = MODELS[model]

  const cacheRead = usage.cacheReadTokens ?? 0
  const cacheWrite = usage.cacheWriteTokens ?? 0

  // 0.1× and 1.25× of an integer rate that is always a multiple of 100.
  const cacheReadRate = spec.inputRate / 10
  const cacheWriteRate = (spec.inputRate * 5) / 4

  return (
    usage.inputTokens * spec.inputRate +
    usage.outputTokens * spec.outputRate +
    cacheRead * cacheReadRate +
    cacheWrite * cacheWriteRate
  )
}

/**
 * The value written to `agent_runs.cost_cents`, which is `numeric`.
 *
 * A decimal string rather than a JavaScript number, so the exact micro-cent total
 * reaches Postgres without a float ever holding it.
 */
export function costCentsColumn(microCents: number | null): string | null {
  if (microCents === null) return null
  const whole = Math.trunc(microCents / MICRO_CENTS_PER_CENT)
  const fraction = Math.abs(microCents % MICRO_CENTS_PER_CENT)
  return `${whole}.${String(fraction).padStart(6, '0')}`
}

/** For display and for anyone reasoning about a single call rather than a month of them. */
export function formatMicroCents(microCents: number): string {
  return `${(microCents / MICRO_CENTS_PER_CENT).toFixed(4)} ¢`
}
