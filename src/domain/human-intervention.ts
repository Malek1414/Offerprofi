/**
 * Human intervention on demand (PRODUCT_SPEC §12.6 invariant 5).
 *
 * A persistent "mit {Owner} sprechen" control in the chat, on the quote, and in every
 * email. Requesting a human pauses automation immediately and notifies the owner.
 * Every request is logged in `human_interventions` as an Art. 22 evidence trail.
 *
 * The word that matters here is *advertised*. The EDPB's position is that a right to
 * human intervention which the data subject has to discover, or ask for twice, is not
 * a meaningful safeguard. So the control is visible on every surface at every stage,
 * including states where it seems pointless — an expired quote is exactly when a
 * confused customer most wants a person.
 */

export type InterventionTrigger = 'customer_request' | 'escalation' | 'owner_initiated'

/** Every surface the control must appear on. Enumerated so a test can check them all. */
export const INTERVENTION_SURFACES = ['chat', 'quote', 'email', 'detail_form'] as const
export type InterventionSurface = (typeof INTERVENTION_SURFACES)[number]

export interface HumanIntervention {
  id: string
  agencyId: string
  inquiryId: string
  trigger: InterventionTrigger
  surface: InterventionSurface
  requestedAt: string
  respondedAt: string | null
  userId: string | null
}

/**
 * Whether the control renders. It always does.
 *
 * This function exists so the answer is written down in one place and can be tested,
 * rather than being re-derived in four templates by four people who each have a
 * different idea of when it would be "cleaner" to hide it.
 */
export function isInterventionAvailable(_surface: InterventionSurface, _quoteState?: string): true {
  return true
}

export interface InterventionResult {
  intervention: Omit<HumanIntervention, 'id'>
  /** Automation stops here. No further agent turn is generated for this inquiry. */
  automationPaused: true
  notifyOwner: true
}

/**
 * Record a request for a human and pause automation.
 *
 * Pausing is not a side effect to be wired up later by the caller — it is part of the
 * return type, so a caller that ignores it fails review rather than shipping a
 * "speak to a human" button that does nothing but log.
 */
export function requestHuman(params: {
  agencyId: string
  inquiryId: string
  trigger: InterventionTrigger
  surface: InterventionSurface
  now: string
}): InterventionResult {
  return {
    intervention: {
      agencyId: params.agencyId,
      inquiryId: params.inquiryId,
      trigger: params.trigger,
      surface: params.surface,
      requestedAt: params.now,
      respondedAt: null,
      userId: null,
    },
    automationPaused: true,
    notifyOwner: true,
  }
}
