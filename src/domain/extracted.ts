/**
 * The vocabulary of extraction, shared by everything the AI fills in.
 *
 * These types started life inside `event-brief.ts` because there was one extracted
 * thing. There are now two — the catering request a customer builds, and the event
 * brief the pricing engine still consumes — and they must agree on what a confidence
 * is, what provenance is, and which half of the data is personal. Two copies of that
 * agreement is how they stop agreeing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INVARIANT 2 IS A TYPE BOUNDARY, AND IT LIVES HERE.
 *
 * `ContactPartition` is the only place a person is described. Nothing that reaches
 * pricing has a field to put a name in — not because a rule says so, but because
 * the type has no such field and there is no cast, no `Omit<>`, and no runtime
 * strip step that anyone can forget to call.
 *
 * Under the current spec the customer never sees an AI-produced price at all, which
 * makes this cheaper to hold than it has ever been. That is not a reason to relax
 * it: the owner-side suggestion still prices, and the day someone shows a customer
 * a number, this boundary is the only thing standing between the product and
 * GDPR Art. 22.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Where a value came from. Owner- and form-supplied values are authoritative (1.0). */
export type ExtractionSource = 'ai' | 'form' | 'owner' | 'customer_confirm'

/** Every extracted value carries its confidence and provenance. Nothing is bare. */
export interface Extracted<T> {
  value: T
  confidence: number
  /** Message id, asset id, or form field the value came from. */
  source?: string
  sourceKind?: ExtractionSource
}

export type Language = 'de' | 'en'
export type Formality = 'du' | 'sie' | 'unknown'

/**
 * Personal data. Its own type, its own column, its own access path.
 *
 * Used for addressing the customer and rendering the document header. Never used to
 * decide anything.
 */
export interface ContactPartition {
  name?: string
  email?: string
  phoneE164?: string
  role?: string
  company?: string
  vatId?: string
}

// ── Confidence policy (spec §4.10) ───────────────────────────────────────────

export const AUTO_SEND_REQUIRED_CONFIDENCE = 0.8
export const AUTO_SEND_OVERALL_CONFIDENCE = 0.75
export const NEVER_GUESS_BELOW = 0.5

export type ConfidenceVerdict<K extends string> =
  | { action: 'auto_price' }
  | { action: 'confirm'; fields: K[] }
  | { action: 'ask'; fields: K[] }

/**
 * The confidence of one field, whatever shape it is in.
 *
 * A list is only as trustworthy as its least certain member — three services
 * extracted confidently and one guessed is a guess about what the customer wants.
 */
export function confidenceOf(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field]
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined
    return Math.min(...value.map((e) => (e as Extracted<unknown>).confidence ?? 0))
  }
  if (typeof value === 'object' && 'confidence' in value) {
    return (value as Extracted<unknown>).confidence
  }
  return undefined
}

/**
 * Decide whether what we have is good enough to act on unattended.
 *
 * Missing entirely and present-but-uncertain are treated identically on purpose:
 * both mean we do not know, and guessing at a wedding date is worse than asking.
 */
export function evaluateFields<K extends string>(
  record: Record<string, unknown>,
  required: readonly K[],
  overallConfidence: number,
): ConfidenceVerdict<K> {
  const ask: K[] = []
  const confirm: K[] = []

  for (const field of required) {
    const c = confidenceOf(record, field)
    if (c === undefined || c < NEVER_GUESS_BELOW) ask.push(field)
    else if (c < AUTO_SEND_REQUIRED_CONFIDENCE) confirm.push(field)
  }

  if (ask.length > 0) return { action: 'ask', fields: ask }
  if (confirm.length > 0) return { action: 'confirm', fields: confirm }
  if (overallConfidence < AUTO_SEND_OVERALL_CONFIDENCE) {
    return { action: 'confirm', fields: required.slice(0, 1) as K[] }
  }
  return { action: 'auto_price' }
}

/**
 * Owner- and form-supplied values always win (spec §4.10).
 *
 * Applied when merging a later extraction over an earlier one, so a model can never
 * overwrite a human. This is what makes a correction stick.
 */
export function mergeExtracted<T>(
  existing: Extracted<T> | undefined,
  incoming: Extracted<T>,
): Extracted<T> {
  if (!existing) return incoming
  const existingIsHuman = existing.sourceKind === 'owner' || existing.sourceKind === 'form'
  const incomingIsHuman = incoming.sourceKind === 'owner' || incoming.sourceKind === 'form'
  if (existingIsHuman && !incomingIsHuman) return existing
  return incoming
}

/** One field, merged. Silence in a later turn is not a retraction. */
export function pickExtracted<T>(
  before: Extracted<T> | undefined,
  after: Extracted<T> | undefined,
): Extracted<T> | undefined {
  if (after === undefined) return before
  if (before === undefined) return after
  return mergeExtracted(before, after)
}

export function clampConfidence(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0
  return Math.min(1, Math.max(0, confidence))
}
