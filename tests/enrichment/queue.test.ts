/**
 * The enrichment queue (C1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT A TYPESCRIPT TEST CAN AND CANNOT SAY ABOUT A LEASE.
 *
 * It can say exactly which jobs a claim is entitled to take at a given instant,
 * and that a job already claimed is not among them — that is `isClaimable` and
 * `selectClaimable`, and it is the whole double-claim guarantee at the level of
 * state: the UPDATE moves the row out of 'queued' in the same statement that
 * selected it, so a second claim no longer matches it.
 *
 * It cannot say anything about two workers hitting Postgres in the same
 * millisecond. That property belongs to `for update skip locked`, which lives in
 * the migration, and the last test in this file asserts that the clause is
 * actually there — a lease whose lock clause was quietly dropped in a refactor
 * would pass every other test here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  BACKOFF_MAX_SECONDS,
  type EnrichmentJob,
  type Queryable,
  backoffSeconds,
  enrichmentReady,
  failJob,
  isClaimable,
  mapJobRow,
  nextAfterFailure,
  operatorUserId,
  selectClaimable,
  toInteger,
} from '../../src/enrichment/queue'

const NOW = new Date('2026-08-11T12:00:00.000Z')

function job(overrides: Partial<EnrichmentJob> = {}): EnrichmentJob {
  return {
    id: 'job-1',
    prospectId: 'prospect-1',
    kind: 'enrich',
    state: 'queued',
    priority: 0,
    attempts: 0,
    maxAttempts: 5,
    budgetMicroCents: 25_000_000,
    spentMicroCents: 0,
    pagesFetched: 0,
    maxPages: 12,
    leasedBy: null,
    leaseExpiresAt: null,
    nextAttemptAt: new Date(NOW.getTime() - 1000),
    stopReason: null,
    failurePermanent: false,
    ...overrides,
  }
}

describe('backoffSeconds', () => {
  it('grows exponentially from half a minute', () => {
    // Jitter pinned at the midpoint, so the curve itself is what is asserted.
    expect(backoffSeconds(1, 0.5)).toBe(30)
    expect(backoffSeconds(2, 0.5)).toBe(60)
    expect(backoffSeconds(3, 0.5)).toBe(120)
    expect(backoffSeconds(4, 0.5)).toBe(240)
    expect(backoffSeconds(5, 0.5)).toBe(480)
  })

  it('stops growing at an hour', () => {
    // Past an hour a job is not retrying, it is waiting for a person — and the
    // honest thing is to let it exhaust its attempts where an operator will see it.
    expect(backoffSeconds(20, 0.5)).toBe(BACKOFF_MAX_SECONDS)
    expect(backoffSeconds(1_000_000, 0.5)).toBe(BACKOFF_MAX_SECONDS)
  })

  it('spreads retries by ±25%, which is what stops a thundering herd', () => {
    // One import enqueues ten thousand jobs at the same instant. Without jitter,
    // the several hundred that fail together retry together, at the same second,
    // aimed at one small business's hosting provider.
    expect(backoffSeconds(3, 0)).toBe(90)
    expect(backoffSeconds(3, 1)).toBe(150)
    expect(backoffSeconds(3, 0.5)).toBe(120)
  })

  it('never returns zero, and never returns something that is not a number', () => {
    for (const attempts of [0, -5, Number.NaN, 1.7]) {
      const value = backoffSeconds(attempts, 0.5)
      expect(Number.isSafeInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(1)
    }
    expect(Number.isSafeInteger(backoffSeconds(3, Number.NaN))).toBe(true)
  })
})

describe('nextAfterFailure', () => {
  it('retries while attempts remain', () => {
    expect(nextAfterFailure({ attempts: 2, maxAttempts: 5, permanent: false, jitter: 0.5 })).toEqual(
      { terminal: false, retryAfterSeconds: 60 },
    )
  })

  it('gives up on the last attempt', () => {
    expect(nextAfterFailure({ attempts: 5, maxAttempts: 5, permanent: false })).toEqual({
      terminal: true,
    })
  })

  it('gives up immediately on a permanent failure', () => {
    // A domain that does not resolve, or a robots.txt that forbids us. Retrying
    // those forever is how a queue turns into a bill.
    expect(nextAfterFailure({ attempts: 1, maxAttempts: 5, permanent: true })).toEqual({
      terminal: true,
    })
  })
})

describe('isClaimable — the lease', () => {
  it('takes a queued job whose time has come', () => {
    expect(isClaimable(job(), NOW)).toBe(true)
  })

  it('leaves a queued job that is still backing off', () => {
    expect(isClaimable(job({ nextAttemptAt: new Date(NOW.getTime() + 60_000) }), NOW)).toBe(false)
  })

  it('will not double-claim a job whose lease is still live', () => {
    // The claim in the migration moves the row to 'leased' in the same statement
    // that selected it, so a second worker's SELECT no longer matches. This is
    // that guarantee, stated as a predicate.
    const leased = job({
      state: 'leased',
      leasedBy: 'worker-a',
      leaseExpiresAt: new Date(NOW.getTime() + 30_000),
    })
    expect(isClaimable(leased, NOW)).toBe(false)
  })

  it('reclaims a job whose lease has run out', () => {
    // The recovery path for a worker that was killed mid-run. It needs no
    // watchdog, no scheduler and nobody noticing — which is the entire argument
    // for a lease over a boolean `locked` column.
    const abandoned = job({
      state: 'leased',
      leasedBy: 'worker-a',
      leaseExpiresAt: new Date(NOW.getTime() - 1),
    })
    expect(isClaimable(abandoned, NOW)).toBe(true)
  })

  it('never reclaims a terminal job', () => {
    for (const state of ['succeeded', 'failed', 'capped'] as const) {
      expect(isClaimable(job({ state }), NOW)).toBe(false)
    }
  })
})

describe('selectClaimable', () => {
  it('claims priority first, then the longest-waiting', () => {
    const urgent = job({ id: 'urgent', priority: 5, nextAttemptAt: new Date(NOW.getTime() - 10) })
    const old = job({ id: 'old', priority: 0, nextAttemptAt: new Date(NOW.getTime() - 10_000) })
    const recent = job({ id: 'recent', priority: 0, nextAttemptAt: new Date(NOW.getTime() - 100) })

    expect(selectClaimable([recent, old, urgent], NOW, 3).map((j) => j.id)).toEqual([
      'urgent',
      'old',
      'recent',
    ])
  })

  it('honours the limit', () => {
    const jobs = [job({ id: 'a' }), job({ id: 'b' }), job({ id: 'c' })]
    expect(selectClaimable(jobs, NOW, 2)).toHaveLength(2)
    expect(selectClaimable(jobs, NOW, 0)).toHaveLength(0)
  })

  it('is empty once every job has been claimed — the second worker gets nothing', () => {
    const claimed = job({
      state: 'leased',
      leasedBy: 'worker-a',
      leaseExpiresAt: new Date(NOW.getTime() + 30_000),
    })
    expect(selectClaimable([claimed], NOW, 10)).toEqual([])
  })
})

describe('toInteger and mapJobRow', () => {
  it('parses the bigint columns pg hands back as strings', () => {
    expect(toInteger('25000000', 'x')).toBe(25_000_000)
    expect(toInteger(12, 'x')).toBe(12)
  })

  it('refuses a value it cannot represent rather than losing the last digits', () => {
    expect(() => toInteger('9007199254740993', 'budget')).toThrow(/safe integer/)
  })

  it('maps a claimed row, including a null lease and a boolean from pg', () => {
    const mapped = mapJobRow({
      id: 'j', prospect_id: 'p', kind: 'enrich', state: 'leased', priority: 3,
      attempts: 1, max_attempts: 5, budget_micro_cents: '25000000', spent_micro_cents: '800000',
      pages_fetched: 2, max_pages: 12, leased_by: 'worker-a',
      lease_expires_at: '2026-08-11T12:01:00.000Z', next_attempt_at: '2026-08-11T12:00:00.000Z',
      stop_reason: null, failure_permanent: false,
    })

    expect(mapped.state).toBe('leased')
    expect(mapped.spentMicroCents).toBe(800_000)
    expect(mapped.leaseExpiresAt?.toISOString()).toBe('2026-08-11T12:01:00.000Z')
    expect(mapped.stopReason).toBeNull()
    expect(mapped.failurePermanent).toBe(false)
  })
})

describe('failJob', () => {
  function recorder(): Queryable & { values: unknown[][] } {
    const values: unknown[][] = []
    return {
      values,
      query(_text: string, params?: unknown[]) {
        values.push(params ?? [])
        return Promise.resolve({ rows: [{ state: 'queued', attempts: 2 }] })
      },
    }
  }

  it('sends a backoff the database can apply', async () => {
    const db = recorder()
    await failJob({ jobId: 'j', reason: 'connection reset', attempts: 2, jitter: 0.5 }, db)
    expect(db.values[0]).toEqual(['j', 'connection reset', false, 60])
  })

  it('sends no delay at all once the failure is terminal', async () => {
    // A terminal job is not waiting for anything, and a `next_attempt_at` an hour
    // out on a row nothing will ever claim is a number that only misleads.
    const db = recorder()
    await failJob({ jobId: 'j', reason: 'robots.txt forbids us', permanent: true }, db)
    expect(db.values[0]).toEqual(['j', 'robots.txt forbids us', true, 0])
  })

  it('always sends a reason, including on the retry path', async () => {
    // Three transient failures followed by a success is a fact worth having when
    // the same site fails permanently next month.
    const db = recorder()
    await failJob({ jobId: 'j', reason: 'timeout', attempts: 1, jitter: 0.5 }, db)
    expect(db.values[0]?.[1]).toBe('timeout')
  })
})

describe('configuration', () => {
  it('needs an operator identity, because the tables are behind the operator gate', () => {
    // Making the queue functions `security definer` so a daemon needs no identity
    // would create a second route to prospect data that RLS no longer guards.
    expect(operatorUserId({})).toBeNull()
    expect(operatorUserId({ ENRICHMENT_OPERATOR_USER_ID: '  ' })).toBeNull()
    expect(operatorUserId({ ENRICHMENT_OPERATOR_USER_ID: ' abc ' })).toBe('abc')
    expect(enrichmentReady({})).toBe(false)
  })
})

describe('the claim really is locked in the database', () => {
  const migration = readFileSync(
    join(__dirname, '..', '..', 'db', 'migrations', '0021_enrichment_queue.sql'),
    'utf8',
  )

  it('claims under `for update skip locked`', () => {
    // Without SKIP LOCKED, worker B blocks on the row worker A holds, waits out
    // A's entire transaction — network fetches and all — and only then discovers
    // the row is no longer eligible. Every worker serialises behind the slowest.
    const claim = migration.slice(migration.indexOf('function public.claim_enrichment_jobs'))
    expect(claim).toContain('for update skip locked')
  })

  it('counts an attempt at claim time, not at failure time', () => {
    // A worker killed after claiming never reports anything. A counter that only
    // moved on a reported failure would let such a job be reclaimed forever.
    const claim = migration.slice(migration.indexOf('function public.claim_enrichment_jobs'))
    expect(claim.slice(0, claim.indexOf('$$;'))).toContain('attempts = j.attempts + 1')
  })

  it('keeps the spend caps as CHECK constraints, not as advice', () => {
    expect(migration).toContain('constraint enrichment_jobs_within_budget')
    expect(migration).toContain('check (spent_micro_cents <= budget_micro_cents)')
    expect(migration).toContain('constraint enrichment_prospect_budget_within_cap')
  })

  it('gates every new table on the platform operator, not on agency membership', () => {
    for (const table of [
      'enrichment_jobs',
      'enrichment_prospect_budget',
      'enrichment_spend',
      'crawl_cache',
    ]) {
      expect(migration).toContain(`'${table}'`)
    }
    expect(migration).toContain('public.is_platform_operator()')
  })
})
