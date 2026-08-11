/**
 * Hourly spend meters for model calls (A3).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A FULL METER ENDS IN A HUMAN, NEVER IN A REFUSAL (I1).
 *
 * Exhausted capacity is the same outcome as a model timeout: automation pauses,
 * a person takes the thread, and the customer is told someone is coming. There is
 * no branch here that says no to anybody, and `admitModelCall` deliberately
 * returns a plain result rather than throwing, so a caller cannot accidentally
 * turn a full meter into an error page in front of a customer.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `agent_runs` already records what every call cost. That is an invoice; it
 * cannot say no. This can, and it is the only thing standing between a retry loop
 * and a bill.
 */

import { asAnonymous } from '../db/client'
import { hasDatabase } from '../lib/demo'

/**
 * Two families, and the difference between them is the whole design.
 *
 * `paid:*` is charged only when a call is actually going to reach the provider.
 * `attempt:*` is charged on every attempt and never refunded — reading and
 * parsing untrusted documents costs real work even when the request is rejected
 * for free afterwards, and without this meter a loop of cheap rejections runs
 * forever at our expense.
 */
export type BudgetScope =
  | 'paid:agency'
  | 'paid:inquiry'
  | 'paid:platform'
  | 'attempt:agency'
  | 'attempt:inquiry'
  | 'attempt:platform'

export interface BudgetLimits {
  attemptAgency: number
  attemptInquiry: number
  attemptPlatform: number
  paidAgency: number
  paidInquiry: number
  paidPlatform: number
}

/**
 * Deliberately generous. The meter is here to stop a runaway loop and a scripted
 * abuser, not to ration a working caterer — a real agency handling a busy morning
 * must never feel this, or it becomes a support call instead of a safety net.
 */
export const DEFAULT_LIMITS: BudgetLimits = {
  attemptAgency: 240,
  attemptInquiry: 80,
  attemptPlatform: 6000,
  paidAgency: 160,
  paidInquiry: 48,
  paidPlatform: 4000,
}

export function budgetLimits(env: NodeJS.ProcessEnv = process.env): BudgetLimits {
  const read = (name: string, fallback: number): number => {
    const raw = env[name]
    if (!raw) return fallback
    const value = Number.parseInt(raw, 10)
    // A typo in an env var must not silently remove the cap.
    return Number.isSafeInteger(value) && value > 0 ? value : fallback
  }
  return {
    attemptAgency: read('MODEL_BUDGET_ATTEMPT_AGENCY', DEFAULT_LIMITS.attemptAgency),
    attemptInquiry: read('MODEL_BUDGET_ATTEMPT_INQUIRY', DEFAULT_LIMITS.attemptInquiry),
    attemptPlatform: read('MODEL_BUDGET_ATTEMPT_PLATFORM', DEFAULT_LIMITS.attemptPlatform),
    paidAgency: read('MODEL_BUDGET_PAID_AGENCY', DEFAULT_LIMITS.paidAgency),
    paidInquiry: read('MODEL_BUDGET_PAID_INQUIRY', DEFAULT_LIMITS.paidInquiry),
    paidPlatform: read('MODEL_BUDGET_PAID_PLATFORM', DEFAULT_LIMITS.paidPlatform),
  }
}

const HOUR_MS = 3_600_000

/** Fixed hourly windows, so every caller in an hour contends for one row. */
export function currentWindow(now: Date = new Date()): Date {
  return new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS)
}

/** Returns the new count, or null when the meter is full. */
export type TakeSlot = (
  _scope: BudgetScope,
  _key: string,
  _limit: number,
  _windowStart: Date,
) => Promise<number | null>

export const takeSlot: TakeSlot = async (scope, key, limit, windowStart) => {
  if (!hasDatabase()) return 1

  return asAnonymous(async (client) => {
    const result = await client.query(
      `select public.take_model_budget_slot($1::text, $2::text, $3::int, $4::timestamptz) as runs`,
      [scope, key, limit, windowStart.toISOString()],
    )
    const runs = result.rows[0]?.runs
    return runs === null || runs === undefined ? null : Number(runs)
  })
}

export type Admission = { admitted: true } | { admitted: false; scope: BudgetScope }

export interface AdmissionInput {
  agencyId: string
  /** Null on the demo tenant. The platform meter still applies. */
  inquiryId: string | null
  now?: Date
}

/**
 * Decide whether a model call may happen, and charge for the decision.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORDER IS THE CORRECTNESS.
 *
 * Attempt meters are charged first and in full, before any meter is allowed to
 * reject — an attempt that trips a later limit has still cost us the work of
 * getting that far, and charging after a rejection leaves cheap rejections free
 * to loop. Paid meters are charged widest-first and stop at the first refusal, so
 * no agency capacity is spent on a call that the platform meter has already
 * decided will not run.
 *
 * The compared repo records three separate reviews finding three different
 * arrangements of this that leaked. It is worth reading the tests before
 * rearranging anything here.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function admitModelCall(
  take: TakeSlot,
  limits: BudgetLimits,
  input: AdmissionInput,
): Promise<Admission> {
  const window = currentWindow(input.now ?? new Date())

  const attempts: ReadonlyArray<readonly [BudgetScope, string, number]> = [
    ['attempt:platform', '', limits.attemptPlatform],
    ['attempt:agency', input.agencyId, limits.attemptAgency],
    ...(input.inquiryId
      ? ([['attempt:inquiry', input.inquiryId, limits.attemptInquiry]] as const)
      : []),
  ]

  // Every one of these is charged, including the ones after a refusal: the work
  // was done regardless, and a partial charge is how a loop stays cheap.
  let refused: BudgetScope | null = null
  for (const [scope, key, limit] of attempts) {
    const taken = await take(scope, key, limit, window)
    if (taken === null && refused === null) refused = scope
  }
  if (refused) return { admitted: false, scope: refused }

  const paid: ReadonlyArray<readonly [BudgetScope, string, number]> = [
    ['paid:platform', '', limits.paidPlatform],
    ['paid:agency', input.agencyId, limits.paidAgency],
    ...(input.inquiryId ? ([['paid:inquiry', input.inquiryId, limits.paidInquiry]] as const) : []),
  ]

  for (const [scope, key, limit] of paid) {
    const taken = await take(scope, key, limit, window)
    // Stop at the first refusal. Charging the narrower meters afterwards would
    // bill an agency for a call that was never going to happen.
    if (taken === null) return { admitted: false, scope }
  }

  return { admitted: true }
}
