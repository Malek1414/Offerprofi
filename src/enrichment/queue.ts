/**
 * The enrichment work queue (C1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE QUEUE IS POSTGRES. THIS FILE IS A THIN HAND ON TOP OF IT.
 *
 * Every decision that has to be correct under concurrency — who holds a job, is
 * it still theirs, has the budget run out — is made by a function in
 * db/migrations/0021, inside one transaction, under `for update skip locked`.
 * Nothing in this file re-implements any of it, because a claim decided here
 * would be a read followed by a write with a gap in between, and two workers in
 * that gap both claim the same prospect and both spend its budget.
 *
 * What *is* here is the arithmetic and the shape: the backoff curve, the
 * eligibility predicate, the row mapping. All of it pure, all of it tested
 * without a database, and all of it mirroring what the SQL already enforces so
 * that a caller can reason about a job it is holding without another round trip.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * D33, restated because it is easy to drift from: this queue is not in Astra,
 * not in Cognee and not in n8n. n8n observes it — a webhook on
 * candidate-confirmed for the C5 metric, a Slack post on escalation — and never
 * orchestrates it.
 */

import { hasDatabase, withUser } from '../db/client'

/**
 * The narrow slice of `pg` this module uses.
 *
 * Declared structurally rather than imported as `PoolClient` so that a test can
 * pass a fake without constructing a pool, and so that nothing here depends on
 * the driver beyond "something that runs parameterised SQL".
 */
export interface Queryable {
  query(_text: string, _values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>
}

/**
 * Just enough of the environment to read a variable out of it.
 *
 * `NodeJS.ProcessEnv` would be the obvious type and is the wrong one here: this
 * project's Next.js types make `NODE_ENV` required on it, so a test could not
 * pass `{ ENRICHMENT_OPERATOR_USER_ID: '...' }` without also inventing a
 * NODE_ENV that has nothing to do with what is under test. `process.env` is
 * assignable to this, and so is an object literal naming exactly the variables a
 * test cares about.
 */
export type EnvLike = Record<string, string | undefined>

export type EnrichmentJobState = 'queued' | 'leased' | 'succeeded' | 'failed' | 'capped'

export interface EnrichmentJob {
  id: string
  prospectId: string
  kind: string
  state: EnrichmentJobState
  priority: number
  attempts: number
  maxAttempts: number
  budgetMicroCents: number
  spentMicroCents: number
  pagesFetched: number
  maxPages: number
  leasedBy: string | null
  leaseExpiresAt: Date | null
  nextAttemptAt: Date
  stopReason: string | null
  failurePermanent: boolean
}

// ─── The backoff ────────────────────────────────────────────────────────────

/**
 * First retry lands half a minute out. Long enough for a blip to clear, short
 * enough that a transient failure does not visibly stall an operator watching
 * one prospect go through.
 */
export const BACKOFF_BASE_SECONDS = 30
/**
 * And no retry waits longer than an hour. Past that the job is not really
 * retrying, it is waiting for a person, and the honest thing is to let it use up
 * its attempts and land in 'failed' where an operator will see it.
 */
export const BACKOFF_MAX_SECONDS = 3600

/**
 * Exponential backoff with jitter.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE JITTER IS NOT DECORATION.
 *
 * Enrichment jobs are enqueued in bulk — one import drops ten thousand of them
 * in at the same instant. If the prospect's hosting provider has a bad minute,
 * several hundred fail together and, without jitter, retry together, at the same
 * second, forever. That is a self-inflicted thundering herd aimed at a small
 * business's website, and it is the sort of thing that gets a crawler blocked by
 * a hosting provider — which costs us every prospect on that provider, not just
 * this one.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ±25% around the exponential point, so the spread grows with the delay. `jitter`
 * is a parameter rather than a call to `Math.random` inside, because a backoff
 * curve is arithmetic worth asserting at fixed inputs and an untestable random
 * is how an off-by-one in the exponent survives review.
 */
export function backoffSeconds(attempts: number, jitter: number = Math.random()): number {
  const safeAttempts = Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 1
  // 2^attempts overflows into Infinity long before it matters; clamp the exponent
  // rather than the result so the multiplication never sees a non-finite number.
  const exponent = Math.min(safeAttempts - 1, 20)
  const point = Math.min(BACKOFF_BASE_SECONDS * 2 ** exponent, BACKOFF_MAX_SECONDS)
  const spread = 0.75 + clamp01(jitter) * 0.5
  return Math.max(1, Math.round(point * spread))
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/**
 * What `fail_enrichment_job` will decide, decided here too.
 *
 * The database is the authority — it makes the call against the same `attempts`
 * value the claim wrote, under a row lock. This exists so the worker can log
 * "giving up on this prospect" *before* the round trip, and so the rule is
 * written down somewhere a person can read it.
 */
export function nextAfterFailure(input: {
  attempts: number
  maxAttempts: number
  permanent: boolean
  jitter?: number
}): { terminal: true } | { terminal: false; retryAfterSeconds: number } {
  if (input.permanent || input.attempts >= input.maxAttempts) return { terminal: true }
  return { terminal: false, retryAfterSeconds: backoffSeconds(input.attempts, input.jitter) }
}

// ─── Eligibility ────────────────────────────────────────────────────────────

/**
 * The claim query's WHERE clause, in TypeScript.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A LEASE, NOT A LOCKED FLAG.
 *
 * A job is claimable when it is queued and due, **or** when it is leased and the
 * lease has run out. The second arm is the whole reason a lease exists: a worker
 * killed mid-run — an OOM, a deploy, a machine that simply vanishes — never gets
 * to release anything, and a boolean `locked` column would leave that job held
 * forever by a process that no longer exists. An expiring lease means the
 * pathological case repairs itself, with no watchdog and nobody noticing.
 *
 * The cost is the case this predicate makes visible: a *slow* worker's job can
 * be taken from under it. That is why `heartbeatJob` exists, and why every
 * mutating function in 0021 has `and state = 'leased'` (and, for the heartbeat,
 * `and leased_by = ...`) in its WHERE — a worker that lost its lease gets
 * `false` back and stops, rather than writing over the new owner's work.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function isClaimable(job: EnrichmentJob, now: Date): boolean {
  if (job.state === 'queued') return job.nextAttemptAt.getTime() <= now.getTime()
  if (job.state === 'leased') {
    return job.leaseExpiresAt !== null && job.leaseExpiresAt.getTime() <= now.getTime()
  }
  return false
}

/**
 * Which jobs a claim would take, in the order it would take them.
 *
 * Mirrors `order by priority desc, next_attempt_at` from 0021. Exported because
 * it is the part of claiming that can be asserted directly: given these rows and
 * this clock, exactly these jobs, in exactly this order. The part that cannot be
 * asserted in TypeScript — that two concurrent workers never take the same row —
 * is `for update skip locked`, and it is tested where it lives, in db/tests.
 */
export function selectClaimable(
  jobs: readonly EnrichmentJob[],
  now: Date,
  limit: number,
): EnrichmentJob[] {
  return jobs
    .filter((job) => isClaimable(job, now))
    .sort(
      (a, b) =>
        b.priority - a.priority || a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime(),
    )
    .slice(0, Math.max(limit, 0))
}

// ─── The connection ─────────────────────────────────────────────────────────

/**
 * Which identity the worker runs as.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE WORKER IS AN OPERATOR, NOT AN EXCEPTION TO THE OPERATOR GATE.
 *
 * Every table in 0021 is behind `is_platform_operator()`, and every function in
 * it is `security invoker`. A background worker therefore needs a real row in
 * `platform_operators`, reached through the same `withUser` path as a human.
 *
 * The tempting alternative — make the queue functions `security definer` so a
 * daemon needs no identity — creates a second route to prospect data that the
 * RLS policies no longer guard, and those policies are the only thing standing
 * between our lead list and every logged-in caterer. One identity mechanism, or
 * the gate is decorative. The bonus is attribution: `leased_by` and the operator
 * id together say exactly who ran what.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function operatorUserId(env: EnvLike = process.env): string | null {
  const value = env.ENRICHMENT_OPERATOR_USER_ID?.trim()
  return value ? value : null
}

/** True when this process can actually run enrichment work. */
export function enrichmentReady(env: EnvLike = process.env): boolean {
  return hasDatabase() && operatorUserId(env) !== null
}

/**
 * Run a unit of enrichment work under the operator identity.
 *
 * Returns `fallback` — never throws, never silently runs without an identity —
 * when the environment is not configured. Under RLS an unset identity would see
 * nothing anyway, so the honest failure is to say so rather than to issue
 * queries that come back empty for reasons nobody can diagnose.
 */
export async function asOperator<T>(fn: (_db: Queryable) => Promise<T>, fallback: T): Promise<T> {
  const userId = operatorUserId()
  if (!hasDatabase() || !userId) return fallback
  return withUser(userId, (client) => fn(client as unknown as Queryable))
}

// ─── Row mapping ────────────────────────────────────────────────────────────

/**
 * `bigint` columns arrive from `pg` as strings, because a JavaScript number
 * cannot hold every bigint. Micro-cent totals are bounded by caps far below
 * `Number.MAX_SAFE_INTEGER`, so a number is the right in-memory type — but the
 * conversion has to be explicit and has to refuse a value it cannot represent,
 * or money silently loses its last digits at exactly the scale where somebody
 * would be trying to explain a bill.
 */
export function toInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? '0'), 10)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} is not a safe integer: ${String(value)}`)
  }
  return parsed
}

export function mapJobRow(row: Record<string, unknown>): EnrichmentJob {
  return {
    id: String(row.id),
    prospectId: String(row.prospect_id),
    kind: String(row.kind),
    state: String(row.state) as EnrichmentJobState,
    priority: toInteger(row.priority, 'priority'),
    attempts: toInteger(row.attempts, 'attempts'),
    maxAttempts: toInteger(row.max_attempts, 'max_attempts'),
    budgetMicroCents: toInteger(row.budget_micro_cents, 'budget_micro_cents'),
    spentMicroCents: toInteger(row.spent_micro_cents, 'spent_micro_cents'),
    pagesFetched: toInteger(row.pages_fetched, 'pages_fetched'),
    maxPages: toInteger(row.max_pages, 'max_pages'),
    leasedBy: row.leased_by === null || row.leased_by === undefined ? null : String(row.leased_by),
    leaseExpiresAt: row.lease_expires_at ? new Date(String(row.lease_expires_at)) : null,
    nextAttemptAt: new Date(String(row.next_attempt_at)),
    stopReason:
      row.stop_reason === null || row.stop_reason === undefined ? null : String(row.stop_reason),
    failurePermanent: row.failure_permanent === true || row.failure_permanent === 't',
  }
}

// ─── The operations ─────────────────────────────────────────────────────────

export interface EnqueueRequest {
  prospectId: string
  kind?: string
  priority?: number
  budgetMicroCents?: number
  maxPages?: number
}

/**
 * Queue enrichment for one prospect.
 *
 * `created: false` means a live job already existed. Not an error — an import
 * loop over ten thousand rows must be safe to re-run after it dies halfway, and
 * the partial unique index in 0021 is what makes the second run a no-op instead
 * of a duplicate crawl of everything it already did.
 */
export async function enqueueEnrichment(
  request: EnqueueRequest,
  db?: Queryable,
): Promise<{ jobId: string; created: boolean } | null> {
  const run = async (client: Queryable) => {
    const result = await client.query(
      `select job_id, created from public.enqueue_enrichment_job(
         $1::uuid, $2::text, $3::smallint, $4::bigint, $5::int)`,
      [
        request.prospectId,
        request.kind ?? 'enrich',
        request.priority ?? 0,
        request.budgetMicroCents ?? null,
        request.maxPages ?? null,
      ],
    )
    const row = result.rows[0]
    if (!row || !row.job_id) return null
    return { jobId: String(row.job_id), created: row.created === true || row.created === 't' }
  }

  return db ? run(db) : asOperator(run, null)
}

export interface ClaimRequest {
  /** Hostname plus process id, typically. Written to `leased_by` for the log. */
  worker: string
  leaseSeconds: number
  limit?: number
}

/**
 * Take up to `limit` jobs under a lease.
 *
 * An empty array is the ordinary quiet-queue answer and also the answer when
 * enrichment is not configured. Both mean "there is nothing for this worker to
 * do", which is the only thing the caller does with the result.
 */
export async function claimEnrichmentJobs(
  request: ClaimRequest,
  db?: Queryable,
): Promise<EnrichmentJob[]> {
  const run = async (client: Queryable) => {
    const result = await client.query(
      `select * from public.claim_enrichment_jobs($1::text, $2::int, $3::int)`,
      [request.worker, Math.max(1, Math.floor(request.leaseSeconds)), request.limit ?? 1],
    )
    return result.rows.map(mapJobRow)
  }

  return db ? run(db) : asOperator(run, [] as EnrichmentJob[])
}

/**
 * Extend a lease this worker still holds.
 *
 * `false` is the signal to stop immediately: it means the lease expired and
 * another worker now owns the job. Continuing past a false heartbeat is how two
 * workers spend one prospect's budget twice.
 */
export async function heartbeatJob(
  jobId: string,
  worker: string,
  leaseSeconds: number,
  db?: Queryable,
): Promise<boolean> {
  const run = async (client: Queryable) => {
    const result = await client.query(
      `select public.heartbeat_enrichment_job($1::uuid, $2::text, $3::int) as ok`,
      [jobId, worker, Math.max(1, Math.floor(leaseSeconds))],
    )
    return result.rows[0]?.ok === true
  }

  return db ? run(db) : asOperator(run, false)
}

export async function completeJob(
  jobId: string,
  result: Record<string, unknown> = {},
  db?: Queryable,
): Promise<boolean> {
  const run = async (client: Queryable) => {
    const rows = await client.query(
      `select public.complete_enrichment_job($1::uuid, $2::jsonb) as ok`,
      [jobId, JSON.stringify(result)],
    )
    return rows.rows[0]?.ok === true
  }

  return db ? run(db) : asOperator(run, false)
}

export interface FailureReport {
  jobId: string
  /** Written to `stop_reason` and read by an operator. Write it for one. */
  reason: string
  /**
   * True for anything a retry cannot change: a domain that does not resolve, a
   * `robots.txt` that forbids us, a URL that is not a URL. Retrying those
   * forever is how a queue turns into a bill.
   */
  permanent?: boolean
  attempts?: number
  maxAttempts?: number
  jitter?: number
}

/**
 * Record why a job failed and let the database decide whether it retries.
 *
 * The delay is computed here and the decision is made there — see 0021. A reason
 * is always recorded, including on the retry path, because three transient
 * failures followed by a success is a fact worth having when the same site fails
 * permanently next month.
 */
export async function failJob(
  report: FailureReport,
  db?: Queryable,
): Promise<{ state: EnrichmentJobState; attempts: number } | null> {
  const decision = nextAfterFailure({
    attempts: report.attempts ?? 1,
    maxAttempts: report.maxAttempts ?? 5,
    permanent: report.permanent ?? false,
    ...(report.jitter === undefined ? {} : { jitter: report.jitter }),
  })
  const retryAfter = decision.terminal ? 0 : decision.retryAfterSeconds

  const run = async (client: Queryable) => {
    const result = await client.query(
      `select state, attempts from public.fail_enrichment_job(
         $1::uuid, $2::text, $3::boolean, $4::int)`,
      [report.jobId, report.reason, report.permanent ?? false, retryAfter],
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      state: String(row.state) as EnrichmentJobState,
      attempts: toInteger(row.attempts, 'attempts'),
    }
  }

  return db ? run(db) : asOperator(run, null)
}
