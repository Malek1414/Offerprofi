/**
 * Guardrail configuration (PRODUCT_SPEC §6).
 *
 * Twelve settings, and that is the whole surface. The buyer is a solo wedding planner
 * on a phone, not an engineer — this form has to be fillable in under three minutes
 * or onboarding does not complete (F2.13).
 *
 * Note what changed from rev. 1 of the spec: `minOrderValue`, `blackoutDates` and
 * `leadTimeMinDays` used to trigger a polite automated decline. They now escalate.
 * An automated refusal of service is the exact fact pattern GDPR Art. 22 was written
 * for, and D22 requires it be impossible rather than merely rare.
 */

import { type Cents, eurosToCents } from '../domain/money'

export interface Guardrails {
  agencyId: string
  /** Below this total → escalate to the owner. Never decline (D23). */
  minOrderValue: Cents
  /** Above this total → the owner approves before anything is sent. */
  maxAutoQuoteValue: Cents
  /** May the agent drop items to fit a stated budget? Never discount either way. */
  allowScopeReduction: boolean
  maxNegotiationRounds: number
  quoteValidityDays: number
  /** Master switch for D3 autonomy. Off means every quote waits for the owner. */
  autoSendEnabled: boolean
  blackoutDates: { startsOn: string; endsOn: string; reason: string }[]
  peakSeasonRanges: { startsOn: string; endsOn: string }[]
  leadTimeMinDays: number
  capacityPerDay: number
  escalationNotify: ('push' | 'email' | 'slack')[]
  /** Agencies whose own material uses emoji get emoji. Everyone else does not. */
  allowEmoji: boolean
}

export function defaultGuardrails(agencyId: string): Guardrails {
  return {
    agencyId,
    minOrderValue: eurosToCents(0),
    maxAutoQuoteValue: eurosToCents(5000),
    allowScopeReduction: true,
    maxNegotiationRounds: 4,
    quoteValidityDays: 14,
    autoSendEnabled: true,
    blackoutDates: [],
    peakSeasonRanges: [],
    leadTimeMinDays: 14,
    capacityPerDay: 1,
    escalationNotify: ['push', 'email'],
    allowEmoji: false,
  }
}
