/**
 * The guardrail form (F2.13, spec §6).
 *
 * Acceptance: "Fillable in under three minutes by a non-technical owner." Twelve
 * settings in three minutes is fifteen seconds each, which is not a design budget you
 * can meet by writing twelve labelled inputs. So:
 *
 *   - **Every setting has a working default** (`defaultGuardrails`). The form is
 *     complete the moment it opens; an owner who reads nothing and presses save gets
 *     a safe configuration. That is the three-minute path — the time budget is for
 *     the two or three she actually wants to change.
 *   - **Four of the twelve are not on the form.** `blackoutDates` and
 *     `peakSeasonRanges` are calendar work that belongs next to a calendar (F4.11),
 *     `escalationNotify` needs channels that do not exist until Phase 10, and
 *     `agencyId` is not a setting. Putting a date-range builder on the onboarding
 *     form would blow the budget on the two settings a new agency is least likely to
 *     need on day one. They keep their defaults and get their own screen later.
 *   - **Every label is a question about her business**, never a parameter name.
 *     "Ab welchem Betrag möchten Sie selbst draufschauen?" is answerable in a few
 *     seconds; "max_auto_quote_value" is not answerable at all.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INVARIANT 1 APPLIES TO THE COPY HERE, not just to the code.
 *
 * `minOrderValue` reads like a minimum order — the sort of rule that would normally
 * turn away a customer below it. It does not, and it must never be described as
 * though it does. An inquiry under the threshold produces a quote *and* an escalation
 * to the owner; nobody is refused. The German wording says so explicitly, because an
 * owner who believes it declines small jobs will set it expecting that behaviour, and
 * the gap between what she believes and what happens is where a complaint comes from.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { parseEuroAmount } from './catalogue-form'

export interface GuardrailForm {
  minOrderValue: string
  maxAutoQuoteValue: string
  allowScopeReduction: boolean
  maxNegotiationRounds: string
  quoteValidityDays: string
  autoSendEnabled: boolean
  leadTimeMinDays: string
  capacityPerDay: string
  allowEmoji: boolean
}

export type GuardrailProblem =
  | { field: 'minOrderValue'; code: 'unparseable' | 'above_max_auto' }
  | { field: 'maxAutoQuoteValue'; code: 'missing' | 'unparseable' | 'zero' }
  | { field: 'maxNegotiationRounds'; code: 'out_of_range' }
  | { field: 'quoteValidityDays'; code: 'out_of_range' }
  | { field: 'leadTimeMinDays'; code: 'out_of_range' }
  | { field: 'capacityPerDay'; code: 'out_of_range' }

export interface ValidatedGuardrails {
  minOrderValueCents: number
  maxAutoQuoteValueCents: number
  allowScopeReduction: boolean
  maxNegotiationRounds: number
  quoteValidityDays: number
  autoSendEnabled: boolean
  leadTimeMinDays: number
  capacityPerDay: number
  allowEmoji: boolean
}

/**
 * Ranges, with the reason each bound exists. None of them is arbitrary and none is a
 * matter of taste — they are the values outside which the product misbehaves.
 */
const RANGES = {
  // Below 1 the agent cannot negotiate at all; above 10 the conversation has failed
  // and should have reached a human several rounds ago.
  maxNegotiationRounds: { min: 1, max: 10 },
  // A quote valid for under a day expires before the customer reads it in the
  // morning. Over a year and the prices in it are fiction.
  quoteValidityDays: { min: 1, max: 365 },
  // Zero lead time is legitimate — some agencies do take same-day work.
  leadTimeMinDays: { min: 0, max: 365 },
  // At least one event a day, or the agency can never be available at all.
  capacityPerDay: { min: 1, max: 50 },
} as const

export function validateGuardrails(
  form: GuardrailForm,
): { ok: true; value: ValidatedGuardrails } | { ok: false; problems: GuardrailProblem[] } {
  const problems: GuardrailProblem[] = []

  // Blank means no threshold, which is the correct reading: an owner who does not
  // want to be told about small jobs leaves it empty.
  let minOrderValueCents = 0
  if (form.minOrderValue?.trim()) {
    const parsed = parseEuroAmount(form.minOrderValue)
    if (parsed === null) problems.push({ field: 'minOrderValue', code: 'unparseable' })
    else minOrderValueCents = parsed
  }

  let maxAutoQuoteValueCents = 0
  let maxUsable = false
  if (!form.maxAutoQuoteValue?.trim()) {
    problems.push({ field: 'maxAutoQuoteValue', code: 'missing' })
  } else {
    const parsed = parseEuroAmount(form.maxAutoQuoteValue)
    if (parsed === null) problems.push({ field: 'maxAutoQuoteValue', code: 'unparseable' })
    else if (parsed === 0) {
      // Zero would hold every quote ever produced, which is what `autoSendEnabled`
      // is for — and switching it off says so plainly instead of hiding the same
      // behaviour behind a number the owner will not connect to the effect.
      problems.push({ field: 'maxAutoQuoteValue', code: 'zero' })
    } else {
      maxAutoQuoteValueCents = parsed
      maxUsable = true
    }
  }

  // A minimum above the auto-send ceiling means every quote trips both thresholds at
  // once, so nothing is ever sent automatically and neither number does what she
  // thinks. Only checked when the ceiling itself is usable — one wrong value, one
  // message.
  if (maxUsable && minOrderValueCents > maxAutoQuoteValueCents) {
    problems.push({ field: 'minOrderValue', code: 'above_max_auto' })
  }

  const maxNegotiationRounds = whole(form.maxNegotiationRounds)
  if (!inRange(maxNegotiationRounds, RANGES.maxNegotiationRounds)) {
    problems.push({ field: 'maxNegotiationRounds', code: 'out_of_range' })
  }

  const quoteValidityDays = whole(form.quoteValidityDays)
  if (!inRange(quoteValidityDays, RANGES.quoteValidityDays)) {
    problems.push({ field: 'quoteValidityDays', code: 'out_of_range' })
  }

  const leadTimeMinDays = whole(form.leadTimeMinDays)
  if (!inRange(leadTimeMinDays, RANGES.leadTimeMinDays)) {
    problems.push({ field: 'leadTimeMinDays', code: 'out_of_range' })
  }

  const capacityPerDay = whole(form.capacityPerDay)
  if (!inRange(capacityPerDay, RANGES.capacityPerDay)) {
    problems.push({ field: 'capacityPerDay', code: 'out_of_range' })
  }

  if (problems.length > 0) return { ok: false, problems }

  return {
    ok: true,
    value: {
      minOrderValueCents,
      maxAutoQuoteValueCents,
      allowScopeReduction: Boolean(form.allowScopeReduction),
      maxNegotiationRounds: maxNegotiationRounds as number,
      quoteValidityDays: quoteValidityDays as number,
      autoSendEnabled: Boolean(form.autoSendEnabled),
      leadTimeMinDays: leadTimeMinDays as number,
      capacityPerDay: capacityPerDay as number,
      allowEmoji: Boolean(form.allowEmoji),
    },
  }
}

function whole(raw: string): number | null {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return null
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? value : null
}

function inRange(value: number | null, range: { min: number; max: number }): boolean {
  return value !== null && value >= range.min && value <= range.max
}

export { RANGES as GUARDRAIL_RANGES }
