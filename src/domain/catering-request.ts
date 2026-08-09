/**
 * The CateringRequest — what a customer builds, and the only thing the AI produces.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A REQUEST IS NOT AN OFFER, AND THIS TYPE CANNOT CARRY A PRICE.
 *
 * The customer describes what she wants. The caterer is the first and only party to
 * attach money to it. That is not a policy written in a document — there is no field
 * here for a price, a total, a rate or a discount, and `budgetIndication` is what she
 * said she has to spend, not what anything costs.
 *
 * It buys the thing the old design could never buy: the AI is structurally incapable
 * of quoting wrong, because it is structurally incapable of quoting. A wrong number
 * in front of a customer is a lost deal or a price you have to honour; the same
 * number in front of the caterer is a suggestion a professional overrules in three
 * seconds. The suggestion lives on the owner's side and is computed by the engine
 * from his own catalogue — see src/engine/margin.ts and the owner block on /r/{token}.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `requestedItems` is deliberately **free text**, not catalogue ids. A customer may
 * ask for a paella station whether or not this caterer sells one, and saying so is
 * the request — discarding it because it does not match a catalogue row would throw
 * away the most useful sentence in the conversation. Mapping to catalogue ids happens
 * later, on the owner's side, where a bad match is caught by someone who knows.
 */

import {
  type ConfidenceVerdict,
  type Extracted,
  type Formality,
  type Language,
  evaluateFields,
} from './extracted'

export type {
  ContactPartition,
  Extracted,
  ExtractionSource,
  Formality,
  Language,
} from './extracted'

/** How the food is served. The single biggest driver of what a caterer has to quote. */
export type ServiceStyle =
  | 'buffet'
  | 'plated'
  | 'family_style'
  | 'fingerfood'
  | 'food_station'
  | 'delivery_only'

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snacks' | 'drinks_only' | 'full_day'

/** Whether the caterer cooks on site or delivers. Changes the staffing and the kit. */
export type Fulfilment = 'on_site' | 'delivery' | 'pickup'

export type OccasionType =
  | 'wedding'
  | 'corporate'
  | 'private_party'
  | 'conference'
  | 'funeral'
  | 'other'

/**
 * What the customer wants. Nothing here describes the customer herself — that is
 * `ContactPartition`, and it lives in its own column all the way down.
 */
export interface CateringRequest {
  occasion?: Extracted<OccasionType>
  eventDate?: Extracted<string> // ISO date
  dateFlexible?: Extracted<boolean>
  headcount?: Extracted<number>
  /** Venue or town. A place, not an address that identifies a person. */
  venue?: Extracted<string>
  distanceKm?: Extracted<number>
  durationHours?: Extracted<number>
  serviceStyle?: Extracted<ServiceStyle>
  mealType?: Extracted<MealType>
  fulfilment?: Extracted<Fulfilment>
  /** "6 vegan, 2 gluten-free, no pork" — the thing caterers most often get wrong. */
  dietary?: string[]
  staffingNeeded?: Extracted<boolean>
  equipmentNeeded?: string[]
  /**
   * What she has said she wants to spend. Her number, quoted back, never ours — and
   * never shown to her as though it were a price we agreed to.
   */
  budgetIndication?: Extracted<{ amount: number; currency: 'EUR'; basis: 'total' | 'per_head' }>
  /** Free text. Whatever she asked for, in her words. Mapped to catalogue ids owner-side. */
  requestedItems?: string[]
  specialRequirements?: string[]
  language: Language
  formality: Formality
  meta: RequestMeta
}

export interface RequestMeta {
  extractionVersion: string
  model: string
  completeness: number
  overallConfidence: number
}

/**
 * What a caterer needs before he can say anything useful.
 *
 * Deliberately five, not twelve. Every additional required field is another turn the
 * customer has to sit through before she gets an answer, and a caterer can work with
 * *when, how many, where, how it is served, and which meal*. Everything else improves
 * the answer rather than enabling it — the AI still asks when there is room, it just
 * does not hold the request hostage over it.
 */
export const REQUIRED_REQUEST_FIELDS = [
  'eventDate',
  'headcount',
  'venue',
  'serviceStyle',
  'mealType',
] as const satisfies readonly (keyof CateringRequest)[]

export type RequiredRequestField = (typeof REQUIRED_REQUEST_FIELDS)[number]

/** Is this ready to send to the caterer, or is there still a question worth asking? */
export function evaluateRequest(
  request: CateringRequest,
): ConfidenceVerdict<RequiredRequestField> {
  return evaluateFields(
    request as unknown as Record<string, unknown>,
    REQUIRED_REQUEST_FIELDS,
    request.meta.overallConfidence,
  )
}

/** The stored row. The two halves sit side by side here and still do not merge. */
export interface StoredRequest {
  inquiryId: string
  request: CateringRequest
  contact: import('./extracted').ContactPartition
  completeness: number
  overallConfidence: number
  updatedAt: string
}
