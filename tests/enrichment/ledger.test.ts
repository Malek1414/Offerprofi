/**
 * The enrichment spend ledger (C1).
 *
 * The enforcement lives in `charge_enrichment` and in the CHECK constraints in
 * db/migrations/0021, and is exercised by db/tests/enrichment.sql against a real
 * database. What is under test here is everything the worker relies on before it
 * gets there: that the amounts are integers or nothing at all, that the
 * prediction refuses in the same order the database does, and that a charge which
 * cannot be recorded is a charge that does not happen.
 */

import { describe, expect, it } from 'vitest'

import {
  CRAWL_FETCH_MICRO_CENTS,
  TAVILY_ADVANCED_SEARCH_MICRO_CENTS,
  TAVILY_BASIC_SEARCH_MICRO_CENTS,
  assertMicroCents,
  chargeEnrichment,
  evaluateCharge,
  explainRefusal,
  remaining,
} from '../../src/enrichment/ledger'
import type { Queryable } from '../../src/enrichment/queue'

const STATE = {
  runCap: 25_000_000,
  runSpent: 0,
  prospectCap: 100_000_000,
  prospectSpent: 0,
  pagesFetched: 0,
  maxPages: 12,
}

describe('the rates are integers', () => {
  it('holds every published rate as a whole number of micro-cents', () => {
    // One Tavily credit is $0.008 — 0.8 of a cent, a figure that does not survive
    // being summed a few thousand times in a float.
    for (const rate of [
      TAVILY_BASIC_SEARCH_MICRO_CENTS,
      TAVILY_ADVANCED_SEARCH_MICRO_CENTS,
      CRAWL_FETCH_MICRO_CENTS,
    ]) {
      expect(Number.isSafeInteger(rate)).toBe(true)
      expect(rate).toBeGreaterThan(0)
    }
    expect(TAVILY_ADVANCED_SEARCH_MICRO_CENTS).toBe(TAVILY_BASIC_SEARCH_MICRO_CENTS * 2)
  })

  it('prices a page fetch above zero, so breadth costs something', () => {
    // A fetch priced at exactly zero is a fetch the budget cannot bound at all:
    // a site serving 200-byte pages under a thousand URLs would cost nothing and
    // run forever.
    expect(CRAWL_FETCH_MICRO_CENTS).toBeGreaterThan(0)
  })
})

describe('assertMicroCents', () => {
  it('accepts a whole non-negative amount', () => {
    expect(assertMicroCents(0)).toBe(0)
    expect(assertMicroCents(800_000)).toBe(800_000)
  })

  it('refuses a float rather than rounding it', () => {
    // Rounding here would be a silent decision about money made by the
    // least-informed code in the system. The throw points at the caller that
    // produced the float, which is where the bug is.
    expect(() => assertMicroCents(0.5)).toThrow(/safe integer/)
    expect(() => assertMicroCents(800_000.0001)).toThrow(/safe integer/)
  })

  it('refuses a negative amount, because a charge is not a refund', () => {
    expect(() => assertMicroCents(-1)).toThrow(/negative/)
  })

  it('refuses NaN, Infinity and anything past the safe integer range', () => {
    expect(() => assertMicroCents(Number.NaN)).toThrow()
    expect(() => assertMicroCents(Number.POSITIVE_INFINITY)).toThrow()
    expect(() => assertMicroCents(Number.MAX_SAFE_INTEGER + 2)).toThrow()
  })
})

describe('remaining', () => {
  it('reports what is left', () => {
    expect(remaining(25_000_000, 7_000_000)).toBe(18_000_000)
  })

  it('never goes negative, so a caller can print it without special-casing', () => {
    expect(remaining(100, 250)).toBe(0)
  })
})

describe('evaluateCharge — the cap refuses', () => {
  it('allows a charge that fits', () => {
    expect(evaluateCharge(STATE, 'tavily_search', TAVILY_BASIC_SEARCH_MICRO_CENTS)).toEqual({
      allowed: true,
    })
  })

  it('allows a charge that lands exactly on the cap', () => {
    // The cap is a ceiling, not a fence one micro-cent short of one.
    expect(evaluateCharge({ ...STATE, runSpent: 24_000_000 }, 'model_call', 1_000_000)).toEqual({
      allowed: true,
    })
  })

  it('refuses the charge that would cross the run cap by a single micro-cent', () => {
    expect(evaluateCharge({ ...STATE, runSpent: 24_000_000 }, 'model_call', 1_000_001)).toEqual({
      allowed: false,
      refused: 'run_budget',
    })
  })

  it('refuses on the lifetime prospect cap even when the run has room', () => {
    // The per-run cap alone bounds nothing: C4 re-crawls weekly, so a prospect
    // whose site defeats the extractor would burn a fresh run every week forever
    // and no single run would ever look wrong.
    const state = { ...STATE, prospectSpent: 99_999_999, runSpent: 0 }
    expect(evaluateCharge(state, 'model_call', 2)).toEqual({
      allowed: false,
      refused: 'prospect_budget',
    })
  })

  it('reports the widest cap first when both would be crossed', () => {
    // Raising a run cap for a prospect whose lifetime budget is gone would change
    // nothing, so the reason an operator is shown has to be the outer one.
    const state = { ...STATE, prospectSpent: 100_000_000, runSpent: 25_000_000 }
    expect(evaluateCharge(state, 'model_call', 1)).toEqual({
      allowed: false,
      refused: 'prospect_budget',
    })
  })

  it('applies the page cap to fetches and to nothing else', () => {
    const full = { ...STATE, pagesFetched: 12 }
    expect(evaluateCharge(full, 'crawl_fetch', CRAWL_FETCH_MICRO_CENTS)).toEqual({
      allowed: false,
      refused: 'page_cap',
    })
    // A model call is not a page, and a run that has read its twelve pages must
    // still be able to pay to think about them.
    expect(evaluateCharge(full, 'model_call', 1_000)).toEqual({ allowed: true })
  })

  it('refuses a zero-cost charge once the page cap is reached', () => {
    expect(evaluateCharge({ ...STATE, pagesFetched: 12 }, 'crawl_fetch', 0)).toEqual({
      allowed: false,
      refused: 'page_cap',
    })
  })

  it('refuses to evaluate a malformed amount at all', () => {
    expect(() => evaluateCharge(STATE, 'model_call', 1.5)).toThrow()
  })

  it('mirrors the order charge_enrichment uses', () => {
    // Same three tests, same order, so the worker's prediction and the database's
    // decision cannot disagree about *why* a run stopped.
    const source = explainRefusal('run_budget', { ...STATE, runSpent: 25_000_000 })
    expect(source).toMatch(/run's budget is spent/)
    expect(explainRefusal('prospect_budget', STATE)).toMatch(/lifetime budget/)
    expect(explainRefusal('page_cap', { ...STATE, pagesFetched: 12 })).toMatch(/12 of 12/)
    expect(explainRefusal('no_lease', STATE)).toMatch(/lease/)
    expect(explainRefusal('not_recorded', STATE)).toMatch(/unrecorded spend must not happen/)
  })
})

describe('chargeEnrichment', () => {
  function fakeDb(row: Record<string, unknown> | null): Queryable & { calls: unknown[][] } {
    const calls: unknown[][] = []
    return {
      calls,
      query(text: string, values?: unknown[]) {
        calls.push([text, values])
        return Promise.resolve({ rows: row ? [row] : [] })
      },
    }
  }

  it('reports the totals the database returned', async () => {
    const db = fakeDb({
      charged: true,
      refused: null,
      run_spent: '800000',
      run_remaining: '24200000',
      prospect_spent: '800000',
      prospect_remaining: '99200000',
    })

    const outcome = await chargeEnrichment(
      { jobId: 'job-1', kind: 'tavily_search', microCents: TAVILY_BASIC_SEARCH_MICRO_CENTS },
      db,
    )

    expect(outcome).toEqual({
      ok: true,
      runSpent: 800_000,
      runRemaining: 24_200_000,
      prospectSpent: 800_000,
      prospectRemaining: 99_200_000,
    })
  })

  it('parses bigint columns, which arrive from pg as strings', async () => {
    // A bigint that came back as "24200000" and was used as a string would
    // concatenate rather than add the first time anyone did arithmetic on it.
    const db = fakeDb({
      charged: true,
      refused: null,
      run_spent: '1',
      run_remaining: '2',
      prospect_spent: '3',
      prospect_remaining: '4',
    })
    const outcome = await chargeEnrichment({ jobId: 'j', kind: 'other', microCents: 1 }, db)
    expect(outcome.ok && outcome.runSpent + outcome.runRemaining).toBe(3)
  })

  it('returns a refusal rather than throwing when a cap is hit', async () => {
    // A capped run ends in an operator, not in an exception. Same shape as a full
    // model meter in src/agent/budget.ts, and for the same reason.
    const db = fakeDb({
      charged: false,
      refused: 'run_budget',
      run_spent: '25000000',
      run_remaining: '0',
      prospect_spent: '25000000',
      prospect_remaining: '75000000',
    })

    const outcome = await chargeEnrichment({ jobId: 'j', kind: 'model_call', microCents: 10 }, db)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.refused).toBe('run_budget')
    expect(outcome.detail).toMatch(/budget is spent/)
  })

  it('treats a missing row as a lost lease, not as a success', async () => {
    const outcome = await chargeEnrichment({ jobId: 'j', kind: 'other', microCents: 1 }, fakeDb(null))
    expect(outcome).toMatchObject({ ok: false, refused: 'no_lease' })
  })

  it('refuses a malformed amount before it reaches the database', async () => {
    const db = fakeDb({ charged: true })
    await expect(
      chargeEnrichment({ jobId: 'j', kind: 'model_call', microCents: 12.5 }, db),
    ).rejects.toThrow(/safe integer/)
    expect(db.calls).toHaveLength(0)
  })

  it('refuses to spend when there is no ledger to write to', async () => {
    // No DATABASE_URL and no operator identity: `asOperator` falls through to the
    // fallback. A spend that cannot be written down must not be made, because the
    // cap is only real if every charge lands.
    const outcome = await chargeEnrichment({ jobId: 'j', kind: 'model_call', microCents: 1 })
    expect(outcome).toMatchObject({ ok: false, refused: 'not_recorded' })
  })
})
