/**
 * The EventBrief — structured output of extraction (PRODUCT_SPEC §4.10).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INVARIANT 2 LIVES HERE.
 *
 * The spec renders the brief as one JSON object with a `_contact` key. In the type
 * system it is two disjoint types that never merge, because "we agreed not to pass
 * contact details to pricing" is a convention, and conventions decay. A type that
 * cannot express the mistake does not.
 *
 *   EventBrief         event attributes only — date, guests, hours, km, services
 *   ContactPartition   name, email, phone, company, VAT id, role
 *
 * `EventBrief` has no contact field, so `toPricingInput()` (see pricing-input.ts)
 * cannot forward one even by accident. There is no cast, no `Omit<>`, no runtime
 * strip step that someone can forget to call. The storage layer keeps them in two
 * columns (`event_briefs.brief_json` / `event_briefs.contact_json`) so the separation
 * survives a round-trip through the database too.
 *
 * Consequence: no price can vary by any characteristic of a person, so no profiling
 * occurs, so GDPR Art. 22 does not engage on that limb. A reviewer verifies this by
 * reading two type definitions rather than auditing a codebase.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { CatalogItemId } from './catalogue'

/** Where a value came from. Owner and form values are authoritative (confidence 1.0). */
export type ExtractionSource = 'ai' | 'form' | 'owner' | 'customer_confirm'

/** Every extracted value carries its confidence and provenance. Nothing is bare. */
export interface Extracted<T> {
  value: T
  confidence: number
  /** Message id, asset id, or form field the value came from. */
  source?: string
  sourceKind?: ExtractionSource
}

export type EventType = 'wedding' | 'corporate' | 'equipment_rental' | 'birthday' | 'other'

export type Language = 'de' | 'en'
export type Formality = 'du' | 'sie' | 'unknown'

/**
 * Event attributes. Deliberately contains nothing about a person.
 *
 * Adding a field here that describes the customer rather than the event will fail
 * `tests/invariants/i2-no-pii-in-pricing.test.ts`.
 */
export interface EventBrief {
  eventType?: Extracted<EventType>
  eventDate?: Extracted<string> // ISO date
  dateFlexible?: Extracted<boolean>
  guestCount?: Extracted<number>
  /** Free-text venue or region. A place, not a person's address. */
  location?: Extracted<string>
  distanceKm?: Extracted<number>
  durationHours?: Extracted<number>
  budgetTotal?: Extracted<{ amount: number; currency: 'EUR' }>
  servicesRequested?: Extracted<CatalogItemId>[]
  styleKeywords?: string[]
  specialRequirements?: string[]
  deadlineMentioned?: Extracted<string>
  competingQuotesMentioned?: boolean
  language: Language
  formality: Formality
  meta: BriefMeta
}

export interface BriefMeta {
  extractionVersion: string
  model: string
  completeness: number
  overallConfidence: number
}

/**
 * Personal data. Lives in its own column, its own type, and its own access path.
 *
 * Used for addressing the customer, rendering the quote header, and fulfilling data
 * subject requests. Never used to decide anything.
 */
export interface ContactPartition {
  name?: string
  email?: string
  phoneE164?: string
  role?: string
  company?: string
  vatId?: string
}

/** The stored row. The only place the two halves sit side by side — and even here they do not merge. */
export interface StoredBrief {
  inquiryId: string
  brief: EventBrief
  contact: ContactPartition
  completeness: number
  overallConfidence: number
  updatedAt: string
}

// ── Confidence policy (spec §4.10) ───────────────────────────────────────────

export const REQUIRED_FIELDS: Readonly<Record<EventType, readonly (keyof EventBrief)[]>> = {
  wedding: ['eventDate', 'guestCount', 'location', 'servicesRequested'],
  corporate: ['eventDate', 'guestCount', 'location', 'servicesRequested'],
  equipment_rental: ['eventDate', 'durationHours', 'location', 'servicesRequested'],
  birthday: ['eventDate', 'guestCount', 'servicesRequested'],
  other: ['eventDate', 'servicesRequested'],
}

export const AUTO_SEND_REQUIRED_CONFIDENCE = 0.8
export const AUTO_SEND_OVERALL_CONFIDENCE = 0.75
export const NEVER_GUESS_BELOW = 0.5

export type ConfidenceVerdict =
  | { action: 'auto_price' }
  | { action: 'confirm'; fields: (keyof EventBrief)[] }
  | { action: 'ask'; fields: (keyof EventBrief)[] }

function confidenceOf(brief: EventBrief, field: keyof EventBrief): number | undefined {
  const v = brief[field]
  if (v === undefined || v === null) return undefined
  if (Array.isArray(v)) {
    if (v.length === 0) return undefined
    // A list is only as trustworthy as its least certain member.
    return Math.min(...v.map((e) => (e as Extracted<unknown>).confidence ?? 0))
  }
  if (typeof v === 'object' && 'confidence' in v) return (v as Extracted<unknown>).confidence
  return undefined
}

/**
 * Decide whether extraction is good enough to price and send unattended.
 *
 * Missing entirely and present-but-uncertain are treated the same way on purpose:
 * both mean we do not know, and guessing at a wedding date is worse than asking.
 */
export function evaluateConfidence(brief: EventBrief): ConfidenceVerdict {
  const eventType = brief.eventType?.value ?? 'other'
  const required = REQUIRED_FIELDS[eventType]

  const ask: (keyof EventBrief)[] = []
  const confirm: (keyof EventBrief)[] = []

  for (const field of required) {
    const c = confidenceOf(brief, field)
    if (c === undefined || c < NEVER_GUESS_BELOW) {
      ask.push(field)
    } else if (c < AUTO_SEND_REQUIRED_CONFIDENCE) {
      confirm.push(field)
    }
  }

  if (ask.length > 0) return { action: 'ask', fields: ask }
  if (confirm.length > 0) return { action: 'confirm', fields: confirm }
  if (brief.meta.overallConfidence < AUTO_SEND_OVERALL_CONFIDENCE) {
    return { action: 'confirm', fields: required.slice(0, 1) }
  }
  return { action: 'auto_price' }
}

/**
 * Owner- and form-supplied values always win (spec §4.10). Applied when merging a
 * later extraction over an earlier one so a model can never overwrite a human.
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
