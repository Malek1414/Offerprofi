/**
 * The enrichment spend ledger (C1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INTEGER MICRO-CENTS. THE SAME UNIT AS src/agent/cost.ts, ON PURPOSE.
 *
 * A model call priced by `costMicroCents` and a Tavily search priced here have
 * to be summable against one cap, so they have to be in one unit, and that unit
 * has to be an integer — one Tavily credit is $0.008, which is 0.8 of a cent,
 * which is a number that does not survive being summed a few thousand times in a
 * float. A cap enforced against a total that drifts is not a cap.
 *
 * `assertMicroCents` below refuses anything that is not a non-negative safe
 * integer, and it refuses loudly. That is the only place a float can enter this
 * system, and it is guarded rather than documented, because "remember to round
 * first" is a rule that holds until the first hurried afternoon.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT SAYS NO IS THE DATABASE, NOT THIS FILE.
 *
 * `charge_enrichment` in db/migrations/0021 locks the job row and the prospect
 * budget row, tests both caps, and only then writes both — one transaction, so a
 * refusal charges nothing and a charge cannot exceed. Behind that,
 * `enrichment_jobs_within_budget` is a CHECK constraint, so even a hand-written
 * UPDATE cannot put a run over its limit.
 *
 * `evaluateCharge` here is the same rule in TypeScript. It exists so a worker can
 * decide *not to start* an expensive step it cannot afford — asking for a page
 * we already know we cannot pay to read is a wasted request against somebody
 * else's server — and so the rule is testable at a hundred inputs. It is a
 * prediction, never the enforcement. If the two ever disagree, the database is
 * right.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { formatMicroCents } from '../agent/cost'
import { type Queryable, asOperator, toInteger } from './queue'

/** What a charge bought. Mirrors the CHECK on `enrichment_spend.kind`. */
export type SpendKind = 'tavily_search' | 'crawl_fetch' | 'model_call' | 'other'

// ─── Rates ──────────────────────────────────────────────────────────────────

/**
 * One Tavily credit, $0.008, in micro-cents.
 *
 * Deliberately list price and not the grant price. The SummerUP grant is 8,000
 * free credits, and recording free work as free would produce a per-prospect
 * cost figure that quietly becomes wrong the day the grant runs out — which is
 * precisely the day somebody will ask what a prospect costs. Same reasoning as
 * `cost.ts` keeping Sonnet at list through its introductory pricing: the
 * measurement stays conservative and stays explicable.
 */
export const TAVILY_BASIC_SEARCH_MICRO_CENTS = 800_000
/** Advanced search is two credits. */
export const TAVILY_ADVANCED_SEARCH_MICRO_CENTS = 1_600_000

/**
 * A page fetch: 0.002 of a cent.
 *
 * Nearly nothing, and non-zero on purpose. Bandwidth and worker time really are
 * nearly free here, but a fetch priced at exactly zero is a fetch the budget
 * cannot bound at all — a site serving 200-byte pages under a thousand URLs
 * would cost nothing and run forever. The page cap on `enrichment_jobs` is the
 * primary bound on breadth; this is the one that also shows up on the bill, so
 * "why did this prospect cost so much" has an answer that includes the crawl.
 */
export const CRAWL_FETCH_MICRO_CENTS = 2_000

// ─── The guard ──────────────────────────────────────────────────────────────

/**
 * Refuse anything that is not a whole, non-negative, representable number of
 * micro-cents.
 *
 * Throws rather than rounding. Rounding a float here would be a silent decision
 * about money made by the least-informed code in the system; a throw is a stack
 * trace pointing at the caller that produced the float, which is where the bug
 * actually is.
 */
export function assertMicroCents(value: number, label = 'micro_cents'): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer number of micro-cents, got ${value}`)
  }
  if (value < 0) {
    throw new Error(`${label} must not be negative, got ${value}`)
  }
  return value
}

/** Never negative, so a caller can print it without special-casing an overspend. */
export function remaining(cap: number, spent: number): number {
  return Math.max(assertMicroCents(cap, 'cap') - assertMicroCents(spent, 'spent'), 0)
}

// ─── The prediction ─────────────────────────────────────────────────────────

/** Which ceiling refused. Mirrors `charge_enrichment`'s `refused` column. */
export type ChargeRefusal =
  | 'prospect_budget'
  | 'run_budget'
  | 'page_cap'
  /** The lease was lost, so this worker may not spend against the job any more. */
  | 'no_lease'
  /**
   * No database, or no operator identity. A spend that cannot be written down
   * must not be made — the cap is only real if every charge lands.
   */
  | 'not_recorded'

export interface LedgerState {
  runCap: number
  runSpent: number
  prospectCap: number
  prospectSpent: number
  pagesFetched: number
  maxPages: number
}

/**
 * Would this charge be allowed?
 *
 * Widest ceiling first, exactly as `charge_enrichment` orders it: the reported
 * reason has to be the one an operator can act on, and raising a run cap for a
 * prospect whose lifetime budget is gone would change nothing.
 *
 * The page cap applies only to fetches, which is why `kind` is a parameter here
 * rather than the amount alone.
 */
export function evaluateCharge(
  state: LedgerState,
  kind: SpendKind,
  microCents: number,
): { allowed: true } | { allowed: false; refused: ChargeRefusal } {
  const amount = assertMicroCents(microCents)

  if (state.prospectSpent + amount > state.prospectCap) {
    return { allowed: false, refused: 'prospect_budget' }
  }
  if (state.runSpent + amount > state.runCap) {
    return { allowed: false, refused: 'run_budget' }
  }
  if (kind === 'crawl_fetch' && state.pagesFetched + 1 > state.maxPages) {
    return { allowed: false, refused: 'page_cap' }
  }
  return { allowed: true }
}

/**
 * What an operator reads when a run stops.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A CAPPED RUN IS NOT A REFUSED CUSTOMER (I1).
 *
 * 0021 makes this argument at length and it is repeated here because this is the
 * function that produces the sentence. Invariant 1 governs inquiries — a person
 * who approached the product. A prospect is a business on a list we built who
 * has approached nobody, and hitting a cap stops *our* research spend, not them.
 * Nobody is declined; an operator is told.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function explainRefusal(refused: ChargeRefusal, state: LedgerState): string {
  switch (refused) {
    case 'prospect_budget':
      return `lifetime budget for this prospect is spent (${formatMicroCents(
        state.prospectSpent,
      )} of ${formatMicroCents(state.prospectCap)})`
    case 'run_budget':
      return `this run's budget is spent (${formatMicroCents(state.runSpent)} of ${formatMicroCents(
        state.runCap,
      )})`
    case 'page_cap':
      return `page cap reached (${state.pagesFetched} of ${state.maxPages})`
    case 'no_lease':
      return 'the lease on this job was lost, so it may no longer spend'
    case 'not_recorded':
      return 'no ledger is reachable, and an unrecorded spend must not happen'
  }
}

// ─── The charge ─────────────────────────────────────────────────────────────

export interface ChargeSuccess {
  ok: true
  runSpent: number
  runRemaining: number
  prospectSpent: number
  prospectRemaining: number
}

export interface ChargeRefused {
  ok: false
  refused: ChargeRefusal
  detail: string
  runSpent: number
  runRemaining: number
  prospectSpent: number
  prospectRemaining: number
}

export type ChargeOutcome = ChargeSuccess | ChargeRefused

export interface ChargeRequest {
  jobId: string
  kind: SpendKind
  microCents: number
  /** A URL, a query, a model id. What was bought, in words an operator can read. */
  detail?: string
}

/**
 * Charge the ledger, or find out that we may not.
 *
 * Does not throw on a refusal — a refusal is an ordinary outcome that ends in a
 * stopped run and an operator, not an error page. It *does* throw on a
 * malformed amount, because that is a bug in the caller and swallowing it would
 * mean spending an amount nobody can reconstruct.
 */
export async function chargeEnrichment(
  request: ChargeRequest,
  db?: Queryable,
): Promise<ChargeOutcome> {
  const amount = assertMicroCents(request.microCents, `${request.kind} micro_cents`)

  const run = async (client: Queryable): Promise<ChargeOutcome> => {
    const result = await client.query(
      `select charged, refused, run_spent, run_remaining, prospect_spent, prospect_remaining
         from public.charge_enrichment($1::uuid, $2::text, $3::bigint, $4::text)`,
      [request.jobId, request.kind, amount, request.detail ?? ''],
    )
    const row = result.rows[0]
    if (!row) {
      // The function always returns a row. Nothing coming back means the job id
      // did not exist at all, which is a lost lease as far as a worker cares.
      return notRecorded('no_lease', 'charge_enrichment returned no row')
    }

    const totals = {
      runSpent: toInteger(row.run_spent, 'run_spent'),
      runRemaining: toInteger(row.run_remaining, 'run_remaining'),
      prospectSpent: toInteger(row.prospect_spent, 'prospect_spent'),
      prospectRemaining: toInteger(row.prospect_remaining, 'prospect_remaining'),
    }

    if (row.charged === true || row.charged === 't') return { ok: true, ...totals }

    const refused = (row.refused ? String(row.refused) : 'no_lease') as ChargeRefusal
    return {
      ok: false,
      refused,
      detail: explainRefusal(refused, {
        runCap: totals.runSpent + totals.runRemaining,
        runSpent: totals.runSpent,
        prospectCap: totals.prospectSpent + totals.prospectRemaining,
        prospectSpent: totals.prospectSpent,
        pagesFetched: 0,
        maxPages: 0,
      }),
      ...totals,
    }
  }

  if (db) return run(db)
  return asOperator<ChargeOutcome>(
    run,
    notRecorded('not_recorded', 'enrichment is not configured in this environment'),
  )
}

function notRecorded(refused: ChargeRefusal, detail: string): ChargeRefused {
  return {
    ok: false,
    refused,
    detail,
    runSpent: 0,
    runRemaining: 0,
    prospectSpent: 0,
    prospectRemaining: 0,
  }
}

/**
 * What a prospect has cost us so far, and what is left.
 *
 * Reads the counters rather than summing the ledger — the counters are the
 * enforced totals, and a report that disagrees with the thing doing the
 * enforcing is a report that starts an argument. Summing `enrichment_spend` is
 * the right query for "on what", and the wrong one for "how much".
 */
export async function prospectSpend(
  prospectId: string,
  db?: Queryable,
): Promise<{ cap: number; spent: number; remaining: number } | null> {
  const run = async (client: Queryable) => {
    const result = await client.query(
      `select cap_micro_cents, spent_micro_cents
         from public.enrichment_prospect_budget where prospect_id = $1::uuid`,
      [prospectId],
    )
    const row = result.rows[0]
    if (!row) return null
    const cap = toInteger(row.cap_micro_cents, 'cap_micro_cents')
    const spent = toInteger(row.spent_micro_cents, 'spent_micro_cents')
    return { cap, spent, remaining: remaining(cap, spent) }
  }

  return db ? run(db) : asOperator(run, null)
}
