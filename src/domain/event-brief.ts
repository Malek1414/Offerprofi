/**
 * The EventBrief — the shape the pricing engine consumes (PRODUCT_SPEC §4.10).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS NO LONGER WHAT EXTRACTION PRODUCES.
 *
 * Under the current spec a customer describes a **catering request** and never sees
 * a price; the caterer is the first party to attach money. What the AI fills in is
 * therefore `CateringRequest` (see catering-request.ts). This type is what the
 * *owner-side* price suggestion is computed from — the engine's input shape, kept
 * exactly as it was because it is finished, golden-set tested, and there is no
 * reason to disturb a tested pure function to rename a field.
 *
 * The shared vocabulary both types agree on — `Extracted<T>`, confidence policy,
 * `ContactPartition` — moved to extracted.ts and is re-exported here so the ten
 * files that import `Language` from this path keep working.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * INVARIANT 2: `EventBrief` has no contact field, so `toPricingInput()` cannot
 * forward one even by accident. There is no cast, no `Omit<>`, no runtime strip step
 * that someone can forget to call. The storage layer keeps the two halves in two
 * columns so the separation survives a round trip through the database too.
 */

import type { CatalogItemId } from './catalogue'
import {
  type ConfidenceVerdict,
  type Extracted,
  type Formality,
  type Language,
  evaluateFields,
} from './extracted'

export {
  AUTO_SEND_OVERALL_CONFIDENCE,
  AUTO_SEND_REQUIRED_CONFIDENCE,
  NEVER_GUESS_BELOW,
  mergeExtracted,
} from './extracted'
export type {
  ConfidenceVerdict,
  ContactPartition,
  Extracted,
  ExtractionSource,
  Formality,
  Language,
} from './extracted'

export type EventType = 'wedding' | 'corporate' | 'equipment_rental' | 'birthday' | 'other'

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

/** The stored row. The only place the two halves sit side by side — and even here they do not merge. */
export interface StoredBrief {
  inquiryId: string
  brief: EventBrief
  contact: import('./extracted').ContactPartition
  completeness: number
  overallConfidence: number
  updatedAt: string
}

export const REQUIRED_FIELDS: Readonly<Record<EventType, readonly (keyof EventBrief)[]>> = {
  wedding: ['eventDate', 'guestCount', 'location', 'servicesRequested'],
  corporate: ['eventDate', 'guestCount', 'location', 'servicesRequested'],
  equipment_rental: ['eventDate', 'durationHours', 'location', 'servicesRequested'],
  birthday: ['eventDate', 'guestCount', 'servicesRequested'],
  other: ['eventDate', 'servicesRequested'],
}

/** Decide whether a brief is good enough to price and send unattended. */
export function evaluateConfidence(brief: EventBrief): ConfidenceVerdict<keyof EventBrief & string> {
  const required = REQUIRED_FIELDS[brief.eventType?.value ?? 'other'] as readonly (keyof EventBrief &
    string)[]
  return evaluateFields(
    brief as unknown as Record<string, unknown>,
    required,
    brief.meta.overallConfidence,
  )
}
