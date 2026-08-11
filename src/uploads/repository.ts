/**
 * The upload job, as the application sees it.
 *
 * `jobs.ts` takes a `PoolClient` so it can be composed inside a caller's
 * transaction; this wraps each operation in `withUser`, which is what puts the
 * request's identity on the connection and therefore what makes RLS resolve the
 * tenant. Routes call this, never `jobs.ts` directly — a route that opened its own
 * connection would be a route running outside row level security.
 */

import { hasDatabase, withUser } from '../db/client'
import { objectStore } from '../storage'
import {
  assemble,
  listJobs,
  readJob,
  receiveChunk,
  retryJob,
  startUpload,
  type ChunkProgress,
  type StartUploadInput,
  type StartUploadResult,
  type UploadJob,
} from './jobs'

export async function beginUpload(
  userId: string,
  input: StartUploadInput,
): Promise<StartUploadResult | null> {
  if (!hasDatabase()) return null
  return withUser(userId, (client) => startUpload(client, input))
}

export async function getJob(userId: string, jobId: string): Promise<UploadJob | null> {
  if (!hasDatabase()) return null
  return withUser(userId, (client) => readJob(client, jobId))
}

export async function getJobs(userId: string, agencyId: string): Promise<UploadJob[]> {
  if (!hasDatabase()) return []
  return withUser(userId, (client) => listJobs(client, agencyId))
}

export interface ChunkOutcome extends ChunkProgress {
  job: UploadJob
}

/**
 * Take a chunk, and assemble the moment the last one lands.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ASSEMBLY RUNS IN ITS OWN TRANSACTION, AND THAT IS DELIBERATE.
 *
 * Folding it into the chunk's transaction would look tidier and would be wrong:
 * assembly writes to the object store, which is a network call to a service that
 * can be slow or down. Holding a database transaction open across it means
 * holding a connection and a row lock for the duration of somebody else's outage.
 *
 * Split, the worst case is a job that is `parsing` with its chunks still present
 * and its object not yet written — which is a resumable state, reachable by
 * calling assembly again, and exactly what the state machine is for.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function putChunk(
  userId: string,
  jobId: string,
  chunkIndex: number,
  bytes: Uint8Array,
): Promise<ChunkOutcome | null> {
  if (!hasDatabase()) return null

  const progress = await withUser(userId, (client) => receiveChunk(client, jobId, chunkIndex, bytes))

  if (!progress.complete) {
    const job = await getJob(userId, jobId)
    return job ? { ...progress, job } : null
  }

  const store = objectStore()
  const job = await withUser(userId, (client) => assemble(client, store, jobId))
  return { ...progress, job }
}

export async function retry(userId: string, jobId: string): Promise<UploadJob | null> {
  if (!hasDatabase()) return null
  return withUser(userId, (client) => retryJob(client, jobId))
}
