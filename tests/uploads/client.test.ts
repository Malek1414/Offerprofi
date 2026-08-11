/**
 * The browser uploader.
 *
 * Four claims are worth pinning, and three of them are about resuming rather
 * than about uploading — because uploading works on the first try in every
 * developer's testing and the interesting behaviour only shows up on a train.
 *
 *  · a resumed upload sends the chunks the server does not have, and no others;
 *  · a *finished* job is not re-uploaded, even though it answers with an empty
 *    held-list that looks exactly like a job which has received nothing;
 *  · a transient failure is retried and a permanent one is not, since retrying a
 *    `.pages` file forever is how a queue becomes a bill;
 *  · the backoff jitters, because a train coming out of a tunnel retries every
 *    phone on it in the same millisecond.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  MAX_ATTEMPTS,
  backoffMs,
  classify,
  missingChunks,
  sourceFromBlob,
  uploadFile,
  type UploaderDeps,
} from '../../src/uploads/client'

const CHUNK = 1024 * 1024

/** Deterministic seams: no real clock, no real crypto, no real network. */
function deps(fetchStub: typeof fetch): Partial<UploaderDeps> {
  return {
    fetch: fetchStub,
    sleep: async () => {},
    yieldToBrowser: async () => {},
    random: () => 0.5,
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('missingChunks', () => {
  it('asks for nothing when the server has everything', () => {
    expect(missingChunks(3, [0, 1, 2])).toEqual([])
  })

  it('re-sends only the gap, not everything after it', () => {
    // The case the held-list exists for: chunk 7 died in flight while 8–19 had
    // already landed. A count instead of a list would re-send thirteen chunks.
    const held = [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
    expect(missingChunks(20, held)).toEqual([7])
  })

  it('asks for all of them when the server has none', () => {
    expect(missingChunks(3, [])).toEqual([0, 1, 2])
  })
})

describe('classify', () => {
  it.each([408, 425, 429, 500, 502, 503, 504])('treats %i as worth retrying', (status) => {
    expect(classify(status)).toBe('transient')
  })

  it.each([400, 401, 403, 404, 413, 415, 422])('treats %i as permanent', (status) => {
    expect(classify(status)).toBe('permanent')
  })
})

describe('backoffMs', () => {
  it('doubles', () => {
    expect(backoffMs(2, () => 0)).toBeGreaterThan(backoffMs(1, () => 0))
  })

  it('jitters, so a tunnel full of phones does not retry in one millisecond', () => {
    const low = backoffMs(5, () => 0)
    const high = backoffMs(5, () => 1)
    expect(high).toBeGreaterThan(low)
  })

  it('stops growing at thirty seconds', () => {
    expect(backoffMs(MAX_ATTEMPTS + 20, () => 1)).toBe(30_000)
  })
})

describe('uploadFile', () => {
  const file = () => sourceFromBlob(new Blob(['x'.repeat(10)]), 'leads.csv', 'text/csv')

  it('sends every chunk of a fresh upload', async () => {
    const chunks: number[] = []
    const fetchStub = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      const href = String(url)
      if (href.endsWith('/api/uploads')) {
        return json({ status: 'created', jobId: 'job-1', chunkSize: CHUNK, chunkTotal: 1, chunksHeld: [], state: 'queued' }, 201)
      }
      chunks.push(Number(new URL(href, 'http://x').searchParams.get('index')))
      void init
      return json({ status: 'ok', received: 1, total: 1, state: 'needs_mapping', objectKey: 'a/k' })
    }) as unknown as typeof fetch

    const result = await uploadFile(file(), { deps: deps(fetchStub) })

    expect(result.ok).toBe(true)
    expect(chunks).toEqual([0])
  })

  it('skips the chunks the server already holds', async () => {
    const sent: number[] = []
    const fetchStub = vi.fn(async (url: URL | RequestInfo) => {
      const href = String(url)
      if (href.endsWith('/api/uploads')) {
        return json({
          status: 'resumed',
          jobId: 'job-1',
          chunkSize: 4,
          chunkTotal: 3,
          chunksHeld: [0, 2],
          state: 'uploading',
        })
      }
      const index = Number(new URL(href, 'http://x').searchParams.get('index'))
      sent.push(index)
      return json({ status: 'ok', received: 3, total: 3, state: 'needs_mapping', objectKey: 'a/k' })
    }) as unknown as typeof fetch

    const result = await uploadFile(file(), { deps: deps(fetchStub) })

    expect(sent).toEqual([1])
    expect(result.ok && result.resumed).toBe(true)
    expect(result.ok && result.chunksResumed).toBe(2)
  })

  it('does not re-upload a job the server already finished', async () => {
    // The expensive mistake this guards. `assemble` deletes the staging chunks
    // once the object is written, so a completed job answers with `chunksHeld:
    // []` — byte-identical to a job that has received nothing. A client reading
    // only the list would re-send 25 MB of a file the server finished yesterday.
    let chunkCalls = 0
    const fetchStub = vi.fn(async (url: URL | RequestInfo) => {
      const href = String(url)
      if (href.endsWith('/api/uploads')) {
        return json({
          status: 'resumed',
          jobId: 'job-1',
          chunkSize: CHUNK,
          chunkTotal: 1,
          chunksHeld: [],
          state: 'needs_mapping',
        })
      }
      chunkCalls += 1
      return json({ status: 'ok', received: 1, total: 1, state: 'needs_mapping', objectKey: 'a/k' })
    }) as unknown as typeof fetch

    const result = await uploadFile(file(), { deps: deps(fetchStub) })

    expect(chunkCalls).toBe(0)
    expect(result.ok).toBe(true)
  })

  it('retries a transient failure and then succeeds', async () => {
    let attempts = 0
    const fetchStub = vi.fn(async (url: URL | RequestInfo) => {
      const href = String(url)
      if (href.endsWith('/api/uploads')) {
        return json({ status: 'created', jobId: 'job-1', chunkSize: CHUNK, chunkTotal: 1, chunksHeld: [], state: 'queued' }, 201)
      }
      attempts += 1
      if (attempts === 1) return json({ status: 'unavailable' }, 503)
      return json({ status: 'ok', received: 1, total: 1, state: 'needs_mapping', objectKey: 'a/k' })
    }) as unknown as typeof fetch

    const result = await uploadFile(file(), { deps: deps(fetchStub) })

    expect(attempts).toBe(2)
    expect(result.ok).toBe(true)
  })

  it('gives up immediately on a permanent failure rather than retrying a bill into existence', async () => {
    let calls = 0
    const fetchStub = vi.fn(async () => {
      calls += 1
      return json({ status: 'rejected', reason: { kind: 'unsupported_type', extension: 'pages' } }, 422)
    }) as unknown as typeof fetch

    const result = await uploadFile(
      sourceFromBlob(new Blob(['x']), 'notiz.pages', 'application/octet-stream'),
      { deps: deps(fetchStub) },
    )

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.retryable).toBe(false)
    // One call. Not eight.
    expect(calls).toBeLessThanOrEqual(1)
  })

  it('refuses a voice note on the customer surface before touching the network', async () => {
    // D2's asymmetry, checked client-side too so the customer gets an immediate
    // German sentence rather than a round trip ending in a 422.
    const fetchStub = vi.fn(async () => json({}, 200)) as unknown as typeof fetch

    const result = await uploadFile(
      sourceFromBlob(new Blob(['x']), 'sprachnachricht.m4a', 'audio/mp4'),
      { surface: 'customer', deps: deps(fetchStub) },
    )

    expect(result.ok).toBe(false)
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('reports progress that moves forward and ends at done', async () => {
    const phases: string[] = []
    const fetchStub = vi.fn(async (url: URL | RequestInfo) => {
      if (String(url).endsWith('/api/uploads')) {
        return json({ status: 'created', jobId: 'job-1', chunkSize: CHUNK, chunkTotal: 1, chunksHeld: [], state: 'queued' }, 201)
      }
      return json({ status: 'ok', received: 1, total: 1, state: 'needs_mapping', objectKey: 'a/k' })
    }) as unknown as typeof fetch

    await uploadFile(file(), {
      deps: deps(fetchStub),
      onProgress: (progress) => phases.push(progress.phase),
    })

    // The property that matters is that the phase only ever moves forward and
    // settles on a terminal one. Asserting which phase is reported *first* would
    // pin an implementation detail — progress is emitted after each step
    // completes, so the caller never sees 'hashing' on a file this small.
    const order = ['hashing', 'starting', 'sending', 'assembling', 'done', 'failed']
    const seen = phases.map((phase) => order.indexOf(phase))

    expect(phases.at(-1)).toBe('done')
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
    expect(phases).toContain('sending')
  })
})
