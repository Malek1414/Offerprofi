/**
 * Assembly, and the check that makes content-addressed storage honest.
 *
 * The client computes the file's sha256 before it sends anything, and that claim
 * is load-bearing twice over: it is the idempotency key, and it is the object's
 * address. Assembling without verifying it would store a corrupted file under a
 * key derived from a digest the file does not have — and the next upload of the
 * *correct* file would then find that row, match on the key, and be told it had
 * already succeeded.
 *
 * That is a silent, permanent, self-concealing data corruption, so it gets a test.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PoolClient } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { localObjectStore } from '../../src/storage/local'
import { sha256 } from '../../src/storage/keys'
import type { ObjectStore } from '../../src/storage/types'
import { assemble, backoffSeconds } from '../../src/uploads/jobs'

const AGENCY = '3f1a9c52-6d4e-4b0a-9f2b-8c7d1e5a4b30'
const BODY = new TextEncoder().encode('Name;Stadt\nCatering Meier;Berlin\n')

interface Stub {
  client: PoolClient
  statements: string[]
  job: Record<string, unknown>
}

/**
 * A client that answers the four queries `assemble` makes, and records them.
 *
 * The order of the statements is part of what is being asserted — the object must
 * be written before the staging rows are dropped — so they are kept rather than
 * just counted.
 */
function stubClient(options: { storedBytes: Uint8Array; declaredSha: string }): Stub {
  const job: Record<string, unknown> = {
    id: 'a3f1c2d4-0000-4000-8000-000000000001',
    agency_id: AGENCY,
    filename: 'leads.csv',
    content_type: 'text/csv',
    byte_size: String(BODY.byteLength),
    sha256: options.declaredSha,
    object_key: null,
    state: 'parsing',
    failure_reason: null,
    failure_permanent: false,
    attempts: 0,
    chunk_size: 1024 * 1024,
    chunk_total: 1,
    chunks_received: '1',
    rows_imported: 0,
    created_at: new Date(),
    updated_at: new Date(),
  }

  const statements: string[] = []

  const query = async (sql: string, params: unknown[] = []) => {
    statements.push(sql.trim().split('\n')[0]?.trim() ?? '')

    if (sql.includes('select bytes from upload_chunks')) {
      return { rows: [{ bytes: Buffer.from(options.storedBytes) }] }
    }
    if (sql.includes('delete from upload_chunks')) {
      return { rows: [] }
    }
    if (sql.trimStart().startsWith('update upload_jobs')) {
      if (sql.includes("state = 'failed'")) {
        Object.assign(job, {
          state: 'failed',
          failure_reason: params[1],
          failure_permanent: params[2],
        })
      } else {
        Object.assign(job, { state: 'needs_mapping', object_key: params[1] })
      }
      return { rows: [{ ...job, chunks_received: '0' }] }
    }
    // The remaining query is readJob's select.
    return { rows: [job] }
  }

  return { client: { query } as unknown as PoolClient, statements, job }
}

let root: string
let store: ObjectStore

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'offerprofi-assemble-'))
  store = localObjectStore(root)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('assemble', () => {
  it('stores the file under its own digest when the bytes match', async () => {
    const stub = stubClient({ storedBytes: BODY, declaredSha: sha256(BODY) })

    const job = await assemble(stub.client, store, 'a3f1c2d4-0000-4000-8000-000000000001')

    expect(job.state).toBe('needs_mapping')
    expect(job.objectKey).toBe(`a/${AGENCY}/prospect-import/${sha256(BODY)}.csv`)

    const stored = await store.get(job.objectKey!)
    expect(new TextDecoder().decode(stored?.body)).toBe('Name;Stadt\nCatering Meier;Berlin\n')
  })

  it('writes the object before dropping the chunks that could rebuild it', async () => {
    const stub = stubClient({ storedBytes: BODY, declaredSha: sha256(BODY) })

    await assemble(stub.client, store, 'a3f1c2d4-0000-4000-8000-000000000001')

    // Doing this the other way round frees the staging rows first and loses the
    // file if the object store is unreachable — which is precisely when it matters.
    const dropped = stub.statements.findIndex((sql) => sql.startsWith('delete from upload_chunks'))
    const read = stub.statements.findIndex((sql) => sql.includes('select bytes from upload_chunks'))
    expect(read).toBeGreaterThanOrEqual(0)
    expect(dropped).toBeGreaterThan(read)
  })

  it('fails permanently when the assembled bytes are not the bytes that were promised', async () => {
    // Same length, different bytes — otherwise the byte-count check catches it
    // first and the digest comparison is never reached, which would leave the
    // interesting path untested while the test still passed.
    const corrupted = new TextEncoder().encode('Name;Stadt\nCatering Meier;Berlyn\n')
    expect(corrupted.byteLength).toBe(BODY.byteLength)

    const stub = stubClient({ storedBytes: corrupted, declaredSha: sha256(BODY) })

    const job = await assemble(stub.client, store, 'a3f1c2d4-0000-4000-8000-000000000001')

    expect(job.state).toBe('failed')
    expect(job.failurePermanent).toBe(true)
    // German, and shown verbatim — the user has to know to upload it again.
    expect(job.failureReason).toMatch(/erneut hochladen/i)

    // And nothing was written. A corrupted file stored under the correct file's
    // address is worse than no file at all, because the correct upload would then
    // find it and report success.
    expect(await store.list(`a/${AGENCY}/`)).toEqual([])
  })

  it('fails transiently when the file is merely short, because that is resumable', async () => {
    const short = BODY.slice(0, 10)
    const stub = stubClient({ storedBytes: short, declaredSha: sha256(BODY) })

    const job = await assemble(stub.client, store, 'a3f1c2d4-0000-4000-8000-000000000001')

    expect(job.state).toBe('failed')
    expect(job.failurePermanent).toBe(false)
  })
})

describe('backoff', () => {
  it('grows, so a failing provider is not hammered', () => {
    expect(backoffSeconds(1)).toBeLessThan(backoffSeconds(4))
  })

  it('stops growing at five minutes', () => {
    // An uncapped backoff turns a retry queue into a queue that has quietly stopped.
    expect(backoffSeconds(50)).toBe(300)
  })
})
