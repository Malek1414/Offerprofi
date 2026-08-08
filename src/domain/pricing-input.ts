/**
 * The pricing engine's input contract (PRODUCT_SPEC §7.2, decision D24).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This file is the load-bearing evidence for GDPR Art. 22 non-profiling.
 *
 * There is deliberately no field for name, email, phone, company, address, VAT id,
 * or any other attribute of a person. A regulator, a customer's DPO, or a reviewer
 * satisfies themselves that no profiling occurs by reading this one type — not by
 * auditing a codebase and taking our word for it.
 *
 * `toPricingInput()` below takes an `EventBrief`, which has no contact fields at all
 * (see event-brief.ts). The `ContactPartition` is not a parameter, so it cannot be
 * threaded through "just this once" for a feature that seemed harmless.
 *
 * Do not add a field here that describes the customer rather than the event.
 * `tests/invariants/i2-no-pii-in-pricing.test.ts` enforces this by inspecting this
 * source file directly, so the check survives refactors that would defeat a
 * type-only assertion.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { CatalogItemId, PackageId } from './catalogue'
import type { EventBrief, EventType } from './event-brief'

/**
 * How the requested date compares with the agency's capacity and calendar.
 *
 * None of these outcomes may decline a customer. `hard_conflict`, `capacity_reached`
 * and `below_lead_time` produce alternatives plus an owner escalation (I1) — the
 * engine still prices, it just refuses to *commit* to the date.
 */
export type AvailabilityOutcome =
  | 'available'
  | 'capacity_reached'
  | 'hard_conflict'
  | 'peak_season'
  | 'below_lead_time'

export interface PricingInput {
  eventType: EventType
  /** ISO date. A date, not a person. */
  eventDate: string
  guestCount: number
  durationHours: number
  distanceKm: number
  serviceIds: CatalogItemId[]
  packageIds: PackageId[]
  availability: AvailabilityOutcome
  /** EU B2B reverse charge, only when the VAT id has been validated against VIES (F4.5). */
  reverseCharge: boolean
}

/**
 * Build a `PricingInput` from an event brief.
 *
 * Defaults matter here. A missing guest count becomes 0 rather than a guess, which
 * makes any per-guest line total zero — visibly wrong to the owner rather than
 * plausibly wrong to the customer. The confidence gate in `evaluateConfidence()`
 * should have stopped us long before this point; this is the second line of defence.
 */
export function toPricingInput(
  brief: EventBrief,
  availability: AvailabilityOutcome,
  options: { reverseCharge?: boolean; packageIds?: PackageId[] } = {},
): PricingInput {
  return {
    eventType: brief.eventType?.value ?? 'other',
    eventDate: brief.eventDate?.value ?? '',
    guestCount: brief.guestCount?.value ?? 0,
    durationHours: brief.durationHours?.value ?? 0,
    distanceKm: brief.distanceKm?.value ?? 0,
    serviceIds: (brief.servicesRequested ?? []).map((s) => s.value),
    packageIds: options.packageIds ?? [],
    availability,
    reverseCharge: options.reverseCharge ?? false,
  }
}
