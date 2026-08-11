/**
 * Guardrail configuration, from the row to the type the evaluator takes.
 *
 * `loadGuardrails` in src/onboarding/repository.ts returns the raw row, because
 * the settings screen edits fields and does not care what they mean. The evaluator
 * does care, and reads a `Guardrails` — so the mapping lives here rather than
 * being repeated at each call site, where the two would drift and the drift would
 * show up as a guardrail quietly reading `undefined` and comparing against NaN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A MISSING ROW FALLS BACK TO THE DEFAULTS, WHICH ARE THE STRICT ONES.
 *
 * An agency that has not been through the guardrail screen has no row. The
 * tempting reading is "unconfigured means unconstrained"; it is the wrong one,
 * because the defaults in config.ts include a €5,000 auto-send ceiling, and
 * treating an absent row as "no ceiling" would make the least-configured tenant
 * the least protected one.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { cents, type Cents } from '../domain/money'
import { defaultGuardrails, type Guardrails } from './config'
import { loadGuardrails as loadGuardrailRow } from '../onboarding/repository'

interface GuardrailRow {
  agency_id?: string
  min_order_value_cents?: string | number
  max_auto_quote_value_cents?: string | number
  allow_scope_reduction?: boolean
  max_negotiation_rounds?: number
  quote_validity_days?: number
  auto_send_enabled?: boolean
  blackout_dates?: unknown
  peak_season_ranges?: unknown
  lead_time_min_days?: number
  capacity_per_day?: number
  escalation_notify?: string[]
  allow_emoji?: boolean
}

// `bigint` columns arrive as strings from pg, because they can exceed what a JS
// number holds safely. These are cent amounts on a catering quote, so the
// conversion is safe — but it is done explicitly rather than by coercion, because
// `'500000' > 400000` is false in JavaScript and that is a guardrail that silently
// stops firing.
const centsOf = (value: string | number | undefined, fallback: Cents): Cents => {
  if (value === undefined || value === null) return fallback
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : value
  // `cents()` rejects non-integers and NaN, which is the point of the branded type:
  // a guardrail threshold that quietly became NaN compares false against everything
  // and stops firing without any error being raised anywhere.
  return Number.isFinite(parsed) ? cents(parsed) : fallback
}

export function guardrailsFromRow(agencyId: string, row: GuardrailRow | null): Guardrails {
  const defaults = defaultGuardrails(agencyId)
  if (!row) return defaults

  return {
    agencyId,
    minOrderValue: centsOf(row.min_order_value_cents, defaults.minOrderValue),
    maxAutoQuoteValue: centsOf(row.max_auto_quote_value_cents, defaults.maxAutoQuoteValue),
    allowScopeReduction: row.allow_scope_reduction ?? defaults.allowScopeReduction,
    maxNegotiationRounds: row.max_negotiation_rounds ?? defaults.maxNegotiationRounds,
    quoteValidityDays: row.quote_validity_days ?? defaults.quoteValidityDays,
    autoSendEnabled: row.auto_send_enabled ?? defaults.autoSendEnabled,
    blackoutDates: Array.isArray(row.blackout_dates)
      ? (row.blackout_dates as Guardrails['blackoutDates'])
      : defaults.blackoutDates,
    peakSeasonRanges: Array.isArray(row.peak_season_ranges)
      ? (row.peak_season_ranges as Guardrails['peakSeasonRanges'])
      : defaults.peakSeasonRanges,
    leadTimeMinDays: row.lead_time_min_days ?? defaults.leadTimeMinDays,
    capacityPerDay: row.capacity_per_day ?? defaults.capacityPerDay,
    escalationNotify: Array.isArray(row.escalation_notify)
      ? (row.escalation_notify as Guardrails['escalationNotify'])
      : defaults.escalationNotify,
    allowEmoji: row.allow_emoji ?? defaults.allowEmoji,
  }
}

export async function loadGuardrails(userId: string, agencyId: string): Promise<Guardrails> {
  const row = (await loadGuardrailRow(userId)) as GuardrailRow | null
  return guardrailsFromRow(agencyId, row)
}
