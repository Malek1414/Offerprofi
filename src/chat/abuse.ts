/**
 * Abuse controls (F1.11).
 *
 * Acceptance: "**No path rejects a customer** (I1). The cap alerts the owner; it
 * does not turn anyone away."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INVARIANT 1 LIVES HERE, and this is where it is hardest to hold.
 *
 * Every control in this file is refusal-shaped by default. Spam detection normally
 * bins the message. A daily cap normally returns "try again tomorrow". A honeypot
 * normally drops the request silently. All three would be automated adverse
 * decisions against a customer, and §2.1 forbids the lot.
 *
 * So each one is rebuilt as a **routing** decision. The output type has exactly two
 * handling values — `automate` and `owner_tray` — which are Invariant 1's "an offer
 * is produced, or a human takes over" expressed in a type. There is no third value,
 * and adding one would fail `tests/invariants/i1-no-automated-refusal.test.ts`.
 *
 * What this costs: a spambot's message lands in Lisa's tray instead of a bin, and
 * she flicks it away. What it buys: a real customer whose enthusiastic 06:00
 * message tripped a timing heuristic gets a human instead of a closed door. The
 * asymmetry is the entire argument — a mistakenly binned inquiry is a lost wedding,
 * a mistakenly trayed spam is two seconds.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * No CAPTCHA, deliberately. A CAPTCHA is a third-party script on the customer
 * surface, which would break F1.12 and forfeit the TDDDG §25 "no consent banner"
 * position — and it taxes every real customer to inconvenience a bot.
 */

export type Handling = 'automate' | 'owner_tray'

export type AbuseSignal =
  | 'honeypot_filled'
  | 'submitted_impossibly_fast'
  | 'agency_daily_cap_reached'
  | 'spam_language'
  | 'duplicate_flood'

export interface TriageInput {
  /**
   * A field hidden from humans by CSS. A browser leaves it empty; a form-filling
   * bot fills everything it finds.
   */
  honeypotValue?: string | null
  /** Milliseconds between the form rendering and the message arriving. */
  timeToSubmitMs?: number | null
  text: string
  /** Inquiries already opened for this tenant today. */
  agencyInquiriesToday: number
  /** From the tenant's plan. A cap on *automation*, never on being heard. */
  agencyDailyCap: number
  /** Identical messages already seen from this session. */
  identicalRepeatCount?: number
}

export interface TriageResult {
  /** Two outcomes. Offer, or human. Nothing else is representable. */
  handling: Handling
  signals: AbuseSignal[]
  /** Shown to the owner in the tray so the routing is explainable, not magic. */
  reason: string | null
  /** F1.11 — the cap alerts the owner rather than turning the customer away. */
  ownerAlert: OwnerAlert | null
}

export interface OwnerAlert {
  kind: 'daily_cap_reached' | 'suspected_abuse'
  message: string
}

/**
 * A human cannot read a chat prompt, compose an event inquiry and submit it in
 * under a second and a half. Set low on purpose: this is a signal to route on, not
 * a gate to fail, so a false positive costs a tray entry rather than a customer.
 */
export const MIN_HUMAN_SUBMIT_MS = 1_500

/**
 * Phrases from bulk SEO and crypto spam, which is what actually arrives at a public
 * event-agency inbox. Deliberately narrow: this only changes *who reads the message
 * first*, so precision matters more than recall, and a broad list would send real
 * inquiries to the tray for saying "best price".
 */
const SPAM_MARKERS = [
  'seo services',
  'guest post',
  'backlink',
  'increase your ranking',
  'crypto',
  'bitcoin',
  'forex',
  'investment opportunity',
  'work from home',
  'suchmaschinenoptimierung',
  'linkaufbau',
  'gastbeitrag',
]

export function triageInbound(input: TriageInput): TriageResult {
  const signals: AbuseSignal[] = []

  if (input.honeypotValue !== null && input.honeypotValue !== undefined && input.honeypotValue !== '') {
    signals.push('honeypot_filled')
  }

  if (
    input.timeToSubmitMs !== null &&
    input.timeToSubmitMs !== undefined &&
    input.timeToSubmitMs < MIN_HUMAN_SUBMIT_MS
  ) {
    signals.push('submitted_impossibly_fast')
  }

  if (input.agencyInquiriesToday >= input.agencyDailyCap) {
    signals.push('agency_daily_cap_reached')
  }

  const haystack = input.text.toLowerCase()
  if (SPAM_MARKERS.some((marker) => haystack.includes(marker))) {
    signals.push('spam_language')
  }

  if ((input.identicalRepeatCount ?? 0) >= 3) {
    signals.push('duplicate_flood')
  }

  if (signals.length === 0) {
    return { handling: 'automate', signals, reason: null, ownerAlert: null }
  }

  return {
    handling: 'owner_tray',
    signals,
    reason: describeSignals(signals),
    ownerAlert: buildOwnerAlert(signals, input),
  }
}

function describeSignals(signals: AbuseSignal[]): string {
  const parts: Record<AbuseSignal, string> = {
    honeypot_filled: 'a hidden field was filled in, which a normal browser leaves empty',
    submitted_impossibly_fast: 'the message arrived faster than a person could type it',
    agency_daily_cap_reached: "today's automated quota is used up",
    spam_language: 'the wording matches common bulk-marketing spam',
    duplicate_flood: 'the same message was repeated several times',
  }
  return signals.map((s) => parts[s]).join('; ')
}

function buildOwnerAlert(signals: AbuseSignal[], input: TriageInput): OwnerAlert {
  if (signals.includes('agency_daily_cap_reached')) {
    return {
      kind: 'daily_cap_reached',
      message:
        `Your plan's automated quota for today is used up ` +
        `(${input.agencyInquiriesToday}/${input.agencyDailyCap}). New inquiries are ` +
        `still arriving and still being acknowledged — they are waiting for you in ` +
        `"Needs you" instead of being quoted automatically.`,
    }
  }
  return {
    kind: 'suspected_abuse',
    message:
      `An inquiry was routed to you rather than answered automatically: ` +
      `${describeSignals(signals)}. It has been acknowledged, so nobody is waiting ` +
      `in silence.`,
  }
}

/**
 * Whether the customer still gets an acknowledgement.
 *
 * Always. There is no argument in this function because there is no case where a
 * person who wrote to a business is left in silence by software. It exists as a
 * named function so that the guarantee is a callable, testable thing rather than an
 * assumption spread across route handlers.
 */
export function customerIsAcknowledged(_triage: TriageResult): true {
  return true
}
