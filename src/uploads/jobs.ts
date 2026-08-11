/**
 * The upload job: create it, feed it chunks, assemble it, and say what happened.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * "ZERO UPLOAD FAILURES" IS AN ARCHITECTURE, NOT AN ASPIRATION (B1).
 *
 * The requirement is that a caterer never loses confidence in the product because
 * a file did not go up. That cannot be met by writing careful code, because the
 * failure is not in the code — it is a phone going through a tunnel. It is met by
 * making failure *recoverable and visible*:
 *
 *   · a dropped connection **resumes**, because the server already knows which
 *     chunks it has and says so;
 *   · re-uploading the same file is a **no-op**, because the job is keyed on the
 *     file's own digest — and "I wasn't sure it worked so I did it again" is the
 *     single most common thing a nervous user does;
 *   · the unit of work **survives a restart**, because it is a row;
 *   · a failure **says why**, in German, and offers a retry;
 *   · transient failures **back off**, and permanent ones stop.
 *
 * The last one matters more than it looks. Without the permanent/transient split
 * a queue retries a `.pages` file until someone notices the bill.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { PoolClient } from 'pg'

import { objectKey, sha256 as digestOf, type StorageScope } from '../storage/keys'
import type { ObjectStore } from '../storage/types'
import { CHUNK_BYTES, MAX_UPLOAD_BYTES, chunkCount } from './limits'

export type UploadState = 'queued' | 'uploading' | 'parsing' | 'needs_mapping' | 'imported' | 'failed'

export interface UploadJob {
  id: string
  agencyId: string
  filename: string
  contentType: string
  byteSize: number
  sha256: string
  objectKey: string | null
  state: UploadState
  failureReason: string | null
  failurePermanent: boolean
  attempts: number
  chunkSize: number
  chunkTotal: number
  chunksReceived: number
  rowsImported: number
  createdAt: Date
  updatedAt: Date
}

interface JobRow {
  id: string
  agency_id: string
  filename: string
  content_type: string
  byte_size: string
  sha256: string
  object_key: string | null
  state: UploadState
  failure_reason: string | null
  failure_permanent: boolean
  attempts: number
  chunk_size: number
  chunk_total: number
  chunks_received: string
  rows_imported: number
  created_at: Date
  updated_at: Date
}

// `bigint` and `count(*)` both arrive as strings from pg, because they can exceed
// what a JS number holds. Ours cannot — a 25 MB cap sees to that — so the
// conversion is safe here and nowhere near a money value.
const toJob = (row: JobRow): UploadJob => ({
  id: row.id,
  agencyId: row.agency_id,
  filename: row.filename,
  contentType: row.content_type,
  byteSize: Number(row.byte_size),
  sha256: row.sha256,
  objectKey: row.object_key,
  state: row.state,
  failureReason: row.failure_reason,
  failurePermanent: row.failure_permanent,
  attempts: row.attempts,
  chunkSize: row.chunk_size,
  chunkTotal: row.chunk_total,
  chunksReceived: Number(row.chunks_received),
  rowsImported: row.rows_imported,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const SELECT = `
  select j.*, (select count(*) from upload_chunks c where c.job_id = j.id) as chunks_received
  from upload_jobs j
`

export interface StartUploadInput {
  agencyId: string
  userId: string
  filename: string
  contentType: string
  byteSize: number
  /** sha256 of the whole file, computed by the browser before anything is sent. */
  sha256: string
  scope?: StorageScope
}

export interface StartUploadResult {
  job: UploadJob
  /**
   * Which chunks the server already holds. The client sends the complement.
   *
   * This is the resume, and it is deliberately a *list* rather than a count: a
   * failed upload does not necessarily fail at the end. Chunk 7 of 20 can be the
   * one that died while 8 through 20 succeeded, and a count would make the client
   * re-send thirteen chunks that are already on disk.
   */
  chunksHeld: number[]
  /** True when this call found an existing job rather than creating one. */
  resumed: boolean
}

/**
 * Begin, or rejoin.
 *
 * The upsert is the idempotency guarantee from 0020 expressed as behaviour: the
 * same file from the same agency is the same job, whether the second attempt comes
 * a second later from a retry or a day later from a reopened tab.
 *
 * `do update` rather than `do nothing` on purpose — it returns the existing row,
 * where `do nothing` returns no row at all and would force a second round trip
 * on exactly the path that is already having a bad day.
 */
export async function startUpload(
  client: PoolClient,
  input: StartUploadInput,
): Promise<StartUploadResult> {
  if (input.byteSize <= 0 || input.byteSize > MAX_UPLOAD_BYTES) {
    throw new Error(`startUpload: ${input.byteSize} bytes is outside the accepted range`)
  }

  const total = chunkCount(input.byteSize)

  const inserted = await client.query<JobRow & { inserted: boolean }>(
    `
    insert into upload_jobs
      (agency_id, created_by, scope, filename, content_type, byte_size, sha256,
       chunk_size, chunk_total)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    on conflict (agency_id, sha256) do update
      set updated_at = now()
    returning *, (xmax = 0) as inserted
    `,
    [
      input.agencyId,
      input.userId,
      input.scope ?? 'prospect-import',
      input.filename,
      input.contentType,
      input.byteSize,
      input.sha256,
      CHUNK_BYTES,
      total,
    ],
  )

  const row = inserted.rows[0]
  if (!row) throw new Error('startUpload: the insert returned no row')

  const held = await client.query<{ chunk_index: number }>(
    'select chunk_index from upload_chunks where job_id = $1 order by chunk_index',
    [row.id],
  )

  const job = await readJob(client, row.id)
  if (!job) throw new Error('startUpload: the job vanished immediately after being written')

  return {
    job,
    chunksHeld: held.rows.map((chunk) => chunk.chunk_index),
    // `xmax = 0` is true only for a row this statement inserted. It is how an
    // upsert tells "created" from "found" without a second query.
    resumed: !row.inserted,
  }
}

export async function readJob(client: PoolClient, jobId: string): Promise<UploadJob | null> {
  const result = await client.query<JobRow>(`${SELECT} where j.id = $1`, [jobId])
  const row = result.rows[0]
  return row ? toJob(row) : null
}

export async function listJobs(client: PoolClient, agencyId: string): Promise<UploadJob[]> {
  const result = await client.query<JobRow>(
    `${SELECT} where j.agency_id = $1 order by j.created_at desc limit 100`,
    [agencyId],
  )
  return result.rows.map(toJob)
}

export interface ChunkProgress {
  received: number
  total: number
  state: UploadState
  complete: boolean
}

/**
 * Store one chunk.
 *
 * The counting and the state advance happen inside `record_upload_chunk` (0020)
 * rather than here, so that a process killed between "the chunk landed" and "the
 * job knows about it" cannot exist. That is the exact window this whole design is
 * built to close, and it can only be closed in one statement.
 */
export async function receiveChunk(
  client: PoolClient,
  jobId: string,
  chunkIndex: number,
  bytes: Uint8Array,
): Promise<ChunkProgress> {
  const result = await client.query<{ received: string; total: number; state: UploadState }>(
    'select * from record_upload_chunk($1, $2, $3)',
    [jobId, chunkIndex, Buffer.from(bytes)],
  )

  const row = result.rows[0]
  if (!row) throw new Error(`receiveChunk: no such upload job ${jobId}`)

  const received = Number(row.received)
  return { received, total: row.total, state: row.state, complete: received >= row.total }
}

/**
 * Put the file back together and hand it to the object store.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DIGEST IS VERIFIED HERE, AND THE ORDER OF THESE STEPS IS LOAD-BEARING.
 *
 * The client told us the sha256 before it sent anything, and that claim is what
 * the whole idempotency scheme rests on. Assembling and *not* checking would mean
 * a corrupted chunk produces a file stored under a key derived from a digest it
 * does not have — silently wrong, content-addressed storage that is not addressed
 * by its content, and a re-upload that "succeeds" by matching the wrong row.
 *
 * The object is written **before** the chunks are dropped. The reverse would free
 * the staging rows first and lose the file if the store were unreachable, which
 * is exactly when it matters.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function assemble(
  client: PoolClient,
  store: ObjectStore,
  jobId: string,
): Promise<UploadJob> {
  const job = await readJob(client, jobId)
  if (!job) throw new Error(`assemble: no such upload job ${jobId}`)
  if (job.chunksReceived < job.chunkTotal) {
    throw new Error(
      `assemble: ${job.chunksReceived} of ${job.chunkTotal} chunks have arrived`,
    )
  }

  const chunks = await client.query<{ bytes: Buffer }>(
    'select bytes from upload_chunks where job_id = $1 order by chunk_index',
    [jobId],
  )

  const body = new Uint8Array(Buffer.concat(chunks.rows.map((chunk) => chunk.bytes)))

  if (body.byteLength !== job.byteSize) {
    return failJob(
      client,
      jobId,
      `Die Datei ist unvollständig angekommen (${body.byteLength} statt ${job.byteSize} Bytes).`,
      false,
    )
  }

  const actual = digestOf(body)
  if (actual !== job.sha256) {
    // Permanent: the bytes that arrived are not the bytes that were promised, and
    // re-running assembly over the same rows will reach the same conclusion. The
    // client must start again, which it can, because the digest is its own key.
    return failJob(
      client,
      jobId,
      'Die Datei wurde beim Hochladen verändert. Bitte erneut hochladen.',
      true,
    )
  }

  const key = objectKey({
    agencyId: job.agencyId,
    scope: 'prospect-import',
    sha256: job.sha256,
    filename: job.filename,
  })

  await store.put(key, body, { contentType: job.contentType })

  await client.query('delete from upload_chunks where job_id = $1', [jobId])

  const updated = await client.query<JobRow>(
    `update upload_jobs
     set object_key = $2, state = 'needs_mapping', failure_reason = null,
         failure_permanent = false, updated_at = now()
     where id = $1
     returning *, 0 as chunks_received`,
    [jobId, key],
  )

  const row = updated.rows[0]
  if (!row) throw new Error(`assemble: job ${jobId} vanished while being assembled`)
  return toJob(row)
}

/**
 * Exponential, capped at five minutes.
 *
 * Capped because the thing being waited for is usually a network or a provider,
 * and neither improves after five minutes in a way that ten would improve on.
 * An uncapped backoff turns a retry queue into a queue that has quietly stopped.
 */
export function backoffSeconds(attempts: number): number {
  // The inner clamp only exists to keep the exponent finite; the cap that matters
  // is the outer one. Clamping the exponent low enough to bind first would make
  // the stated five-minute ceiling unreachable and the number above a fiction.
  return Math.min(300, 2 ** Math.min(attempts, 30))
}

/**
 * Record a failure in a form the user can act on.
 *
 * `reason` is German and is shown verbatim — 0020 refuses to store a failed job
 * without one, because a failed file the user can see and cannot understand is
 * worse than no feedback at all: it looks like the product is broken rather than
 * like the file is.
 */
export async function failJob(
  client: PoolClient,
  jobId: string,
  reason: string,
  permanent: boolean,
): Promise<UploadJob> {
  const result = await client.query<JobRow>(
    `update upload_jobs
     set state = 'failed',
         failure_reason = $2,
         failure_permanent = $3,
         attempts = attempts + 1,
         next_attempt_at = case when $3 then null else now() + make_interval(secs => $4) end,
         updated_at = now()
     where id = $1
     returning *, (select count(*) from upload_chunks c where c.job_id = upload_jobs.id) as chunks_received`,
    [jobId, reason, permanent, backoffSeconds(0)],
  )

  const row = result.rows[0]
  if (!row) throw new Error(`failJob: no such upload job ${jobId}`)
  return toJob(row)
}

/**
 * Try again.
 *
 * Refuses on a permanent failure rather than quietly doing nothing, because a
 * retry button that appears to work and changes nothing is the worst of the three
 * available behaviours. The UI hides the button in that case; this is the check
 * behind it, for the request that arrives anyway.
 */
export async function retryJob(client: PoolClient, jobId: string): Promise<UploadJob> {
  const job = await readJob(client, jobId)
  if (!job) throw new Error(`retryJob: no such upload job ${jobId}`)
  if (job.failurePermanent) {
    throw new Error('retryJob: this failure cannot be retried — the file must be uploaded again')
  }

  const state: UploadState = job.chunksReceived >= job.chunkTotal ? 'parsing' : 'uploading'

  const result = await client.query<JobRow>(
    `update upload_jobs
     set state = $2, failure_reason = null, next_attempt_at = null, updated_at = now()
     where id = $1
     returning *, (select count(*) from upload_chunks c where c.job_id = upload_jobs.id) as chunks_received`,
    [jobId, state],
  )

  const row = result.rows[0]
  if (!row) throw new Error(`retryJob: job ${jobId} vanished`)
  return toJob(row)
}
