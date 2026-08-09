/**
 * A `CateringRequest` becomes a `PricingInput` (Phase B2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INVARIANT 2 APPLIES HERE EXACTLY AS IT DOES TO `toPricingInput`.
 *
 * This is a second door into the same room, and it is built to the same spec:
 * it takes the request half, never the contact half, and there is no parameter
 * through which contact data could be threaded "just this once". A
 * `ContactPartition` is not accepted, not imported, and not reachable.
 *
 * `tests/invariants/i2-no-pii-in-pricing.test.ts` inspects this file's source the
 * same way it inspects `pricing-input.ts`. Adding a personal field fails the
 * build, not a review.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The mapping is deliberately dull. Every conversion is a default or a rename;
 * nothing here decides anything, because the interesting decision — which
 * catalogue items answer her free-text request — is a separate step with a human
 * at the end of it (`service-mapping.ts`).
 */

import type { CatalogItemId, PackageId } from './catalogue'
import type { CateringRequest, ServiceStyle } from './catering-request'
import type { EventType } from './event-brief'
import type { AvailabilityOutcome, PricingInput } from './pricing-input'

/**
 * How long a catering event runs when nobody said.
 *
 * Four hours is a dinner service. It matters because per-hour lines multiply by
 * it, and a zero would silently price staffing at nothing — which reads to the
 * caterer as a suggestion he can undercut, when it is really a missing input.
 */
export const DEFAULT_DURATION_HOURS = 4

/**
 * The two occasion vocabularies do not line up, and the gaps are deliberate.
 *
 * `OccasionType` is the catering one and `EventType` predates the pivot. A
 * conference is a corporate event as far as pricing is concerned; a private party
 * and a funeral have no counterpart and become `other`.
 *
 * Nothing is dropped for want of a label, because `eventType` feeds no modifier —
 * the engine keys on date, distance and quantity. Losing precision here costs
 * nothing; losing the request would cost everything.
 */
export function toEventType(request: CateringRequest): EventType {
  switch (request.occasion?.value) {
    case 'wedding':
      return 'wedding'
    case 'corporate':
    case 'conference':
      return 'corporate'
    default:
      return 'other'
  }
}

/**
 * Build a `PricingInput` from a catering request and the services someone chose.
 *
 * The service ids come in as an argument rather than out of the request, and that
 * is the pivot in one signature: `requestedItems` is free text she typed, and the
 * step that turns it into catalogue ids is owner-side, reviewable, and not this
 * function's business.
 */
export function requestToPricingInput(
  request: CateringRequest,
  serviceIds: readonly CatalogItemId[],
  availability: AvailabilityOutcome,
  options: { reverseCharge?: boolean; packageIds?: PackageId[] } = {},
): PricingInput {
  return {
    eventType: toEventType(request),
    eventDate: request.eventDate?.value ?? '',
    // Zero rather than a guess, for the reason `toPricingInput` gives: a per-guest
    // line at zero is visibly wrong to the caterer, where a plausible invention
    // would not be.
    guestCount: request.headcount?.value ?? 0,
    durationHours: request.durationHours?.value ?? DEFAULT_DURATION_HOURS,
    distanceKm: request.distanceKm?.value ?? 0,
    serviceIds: [...serviceIds],
    packageIds: options.packageIds ?? [],
    availability,
    reverseCharge: options.reverseCharge ?? false,
  }
}

/**
 * Does the way the food is served imply staff on site?
 *
 * Not used for pricing — it is a hint for the mapping step, which is why it lives
 * beside the conversion rather than inside the engine. Plated service without
 * staff is not a thing anyone sells.
 */
export function impliesStaffing(style: ServiceStyle | undefined): boolean {
  return style === 'plated' || style === 'family_style' || style === 'buffet'
}
