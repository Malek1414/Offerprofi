/**
 * The S3 driver, against a stub transport.
 *
 * `tests/storage/object-store.test.ts` proves the *contract* against the filesystem
 * driver, because that one can be run for real. What cannot be proven that way is the
 * part of this driver that is protocol rather than behaviour, and three pieces of it
 * are load-bearing:
 *
 *  · **path-style addressing** — virtual-host style is the AWS default and the thing
 *    most S3-compatible providers do not implement, so getting it wrong works against
 *    AWS and fails against every provider D29 actually leaves open;
 *  · **the continuation loop** — S3 truncates a listing at 1000 keys and says so with a
 *    flag, not an error. A single-request `list` returns a partial answer that looks
 *    complete, and `list` is what the B3 deletion path enumerates;
 *  · **404 is an answer, anything else is a fault** — B1 asks `head` whether a chunk
 *    already landed, so a permissions failure reported as "not there" would make a
 *    client re-upload forever without ever surfacing a problem.
 */

import { describe, expect, it } from 'vitest'

import { objectKey } from '../../src/storage/keys'
import { s3ObjectStore } from '../../src/storage/s3'

const AGENCY = '3f1a9c52-6d4e-4b0a-9f2b-8c7d1e5a4b30'
const SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const KEY = objectKey({ agencyId: AGENCY, scope: 'prospect-import', sha256: SHA, filename: 'leads.csv' })

interface Call {
  method: string
  url: string
  headers: Record<string, string>
}

/** A transport that records what it was asked to do and replies from a script. */
function stub(replies: Array<{ status?: number; body?: string; headers?: Record<string, string> }>) {
  const calls: Call[] = []
  let index = 0

  const fetchStub = (async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? 'GET',
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
    })
    const reply = replies[Math.min(index++, replies.length - 1)] ?? {}
    return new Response(reply.body ?? '', {
      status: reply.status ?? 200,
      headers: reply.headers ?? {},
    })
  }) as unknown as typeof fetch

  return { calls, fetchStub }
}

const store = (fetchStub: typeof fetch) =>
  s3ObjectStore({
    endpoint: 'https://s3.eu-central-1.example.com',
    region: 'eu-central-1',
    bucket: 'offerprofi-uploads',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    fetch: fetchStub,
    now: () => new Date('2026-08-11T12:00:00Z'),
  })

describe('s3 driver addressing and signing', () => {
  it('addresses the bucket path-style, not virtual-host style', async () => {
    const { calls, fetchStub } = stub([{ status: 200 }])

    await store(fetchStub).put(KEY, new TextEncoder().encode('x'), { contentType: 'text/csv' })

    expect(calls[0]?.url).toBe(`https://s3.eu-central-1.example.com/offerprofi-uploads/${KEY}`)
    expect(calls[0]?.url).not.toContain('offerprofi-uploads.s3')
  })

  it('signs every request, including the body digest S3 verifies', async () => {
    const { calls, fetchStub } = stub([{ status: 200 }])

    await store(fetchStub).put(KEY, new TextEncoder().encode('hello'), { contentType: 'text/csv' })

    expect(calls[0]?.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//)
    // sha256("hello"), which S3 recomputes and compares before accepting the write.
    expect(calls[0]?.headers["x-amz-content-sha256"]).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    )
  })
})

describe('s3 driver, absence versus fault', () => {
  it('reads a 404 as "not there" rather than an error', async () => {
    const { fetchStub } = stub([{ status: 404 }])
    expect(await store(fetchStub).get(KEY)).toBeNull()
  })

  it('raises a 403 instead of reporting the object as missing', async () => {
    const { fetchStub } = stub([{ status: 403, body: 'SignatureDoesNotMatch' }])

    await expect(store(fetchStub).head(KEY)).rejects.toThrow(/403/)
  })

  it('treats deleting something already gone as success', async () => {
    const { fetchStub } = stub([{ status: 404 }])
    await expect(store(fetchStub).delete(KEY)).resolves.toBeUndefined()
  })
})

describe('s3 driver listing', () => {
  const page = (keys: string[], nextToken?: string) =>
    `<?xml version="1.0"?><ListBucketResult>` +
    keys.map((key) => `<Contents><Key>${key}</Key></Contents>`).join('') +
    `<IsTruncated>${nextToken ? 'true' : 'false'}</IsTruncated>` +
    (nextToken ? `<NextContinuationToken>${nextToken}</NextContinuationToken>` : '') +
    `</ListBucketResult>`

  it('follows the continuation token so a truncated listing is not a partial answer', async () => {
    const { calls, fetchStub } = stub([
      { body: page([`a/${AGENCY}/prospect-import/one.csv`], 'TOKEN-2') },
      { body: page([`a/${AGENCY}/prospect-import/two.csv`]) },
    ])

    const keys = await store(fetchStub).list(`a/${AGENCY}/`)

    expect(keys).toEqual([
      `a/${AGENCY}/prospect-import/one.csv`,
      `a/${AGENCY}/prospect-import/two.csv`,
    ])
    expect(calls).toHaveLength(2)
    expect(calls[1]?.url).toContain('continuation-token=TOKEN-2')
  })

  it('stops when the listing is not truncated', async () => {
    const { calls, fetchStub } = stub([{ body: page([`a/${AGENCY}/prospect-import/only.csv`]) }])

    await store(fetchStub).list(`a/${AGENCY}/`)

    expect(calls).toHaveLength(1)
  })
})
