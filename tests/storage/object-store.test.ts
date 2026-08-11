/**
 * The object-store contract, and the deletion path B3 requires.
 *
 * The contract is exercised against the filesystem driver because that one can be run
 * for real in a test — the S3 driver is the same contract over the network and shares
 * the key handling and the safety checks. What is asserted here is behaviour the rest
 * of Phase B is entitled to rely on:
 *
 *  · writing the same key twice is one object, not two (B1 idempotency);
 *  · a missing object is `null`, never an exception, because "not there" is an ordinary
 *    answer during a resumable upload and exceptions are for broken things;
 *  · deleting is idempotent, because a retried deletion must not fail;
 *  · everything one agency owns can be removed in one call (B3, and §9's legal note).
 */

import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { agencyPrefix, objectKey } from '../../src/storage/keys'
import { localObjectStore } from '../../src/storage/local'
import { deleteAgencyObjects, objectStore } from '../../src/storage/index'
import type { ObjectStore } from '../../src/storage/types'

const AGENCY = '3f1a9c52-6d4e-4b0a-9f2b-8c7d1e5a4b30'
const OTHER = '00000000-0000-4000-8000-000000000001'
const SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

const bytes = (text: string) => new TextEncoder().encode(text)

let root: string
let store: ObjectStore

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'offerprofi-storage-'))
  store = localObjectStore(root)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('object store contract', () => {
  it('returns exactly the bytes it was given', async () => {
    const key = objectKey({ agencyId: AGENCY, scope: 'prospect-import', sha256: SHA, filename: 'leads.csv' })
    const body = bytes('Name;Stadt\nCatering Meier;Berlin\n')

    const written = await store.put(key, body, { contentType: 'text/csv' })
    const read = await store.get(key)

    expect(written).toEqual({ key, size: body.byteLength, contentType: 'text/csv' })
    expect(read?.contentType).toBe('text/csv')
    expect(new TextDecoder().decode(read?.body)).toBe('Name;Stadt\nCatering Meier;Berlin\n')
  })

  it('answers null for an object that is not there rather than throwing', async () => {
    const key = objectKey({ agencyId: AGENCY, scope: 'prospect-import', sha256: SHA, filename: 'missing.csv' })

    expect(await store.get(key)).toBeNull()
    expect(await store.head(key)).toBeNull()
  })

  it('stores one object when the same file is uploaded twice', async () => {
    const key = objectKey({ agencyId: AGENCY, scope: 'prospect-import', sha256: SHA, filename: 'leads.csv' })

    await store.put(key, bytes('same bytes'), { contentType: 'text/csv' })
    await store.put(key, bytes('same bytes'), { contentType: 'text/csv' })

    expect(await store.list(agencyPrefix(AGENCY))).toEqual([key])
  })

  it('deletes idempotently, so a retried deletion is not a failure', async () => {
    const key = objectKey({ agencyId: AGENCY, scope: 'prospect-import', sha256: SHA, filename: 'leads.csv' })
    await store.put(key, bytes('x'), { contentType: 'text/csv' })

    await store.delete(key)
    await store.delete(key)

    expect(await store.head(key)).toBeNull()
  })

  it('lists only what sits under the prefix it was asked for', async () => {
    const mine = objectKey({ agencyId: AGENCY, scope: 'prospect-import', sha256: SHA, filename: 'a.csv' })
    const theirs = objectKey({ agencyId: OTHER, scope: 'prospect-import', sha256: SHA, filename: 'a.csv' })
    await store.put(mine, bytes('mine'), { contentType: 'text/csv' })
    await store.put(theirs, bytes('theirs'), { contentType: 'text/csv' })

    expect(await store.list(agencyPrefix(AGENCY))).toEqual([mine])
  })

  it('refuses a key that would climb out of the store, and writes nothing', async () => {
    await expect(store.put('a/../../escape.txt', bytes('x'), { contentType: 'text/plain' }))
      .rejects.toThrow(/traversal|illegal/i)

    expect(readdirSync(root)).toEqual([])
  })
})

describe('deleteAgencyObjects', () => {
  it('removes everything one agency owns and touches nothing of anyone else', async () => {
    const mine = objectKey({ agencyId: AGENCY, scope: 'prospect-import', sha256: SHA, filename: 'a.csv' })
    const alsoMine = objectKey({ agencyId: AGENCY, scope: 'brand-asset', sha256: SHA, filename: 'logo.png' })
    const theirs = objectKey({ agencyId: OTHER, scope: 'prospect-import', sha256: SHA, filename: 'a.csv' })
    for (const key of [mine, alsoMine, theirs]) {
      await store.put(key, bytes('x'), { contentType: 'application/octet-stream' })
    }

    const removed = await deleteAgencyObjects(store, AGENCY)

    expect(removed).toBe(2)
    expect(await store.list(agencyPrefix(AGENCY))).toEqual([])
    expect(await store.head(theirs)).not.toBeNull()
  })
})

describe('objectStore()', () => {
  const s3Env = {
    S3_ENDPOINT: 'https://s3.eu-central-1.example.com',
    S3_REGION: 'eu-central-1',
    S3_BUCKET: 'offerprofi-uploads',
    S3_ACCESS_KEY_ID: 'AKIDEXAMPLE',
    S3_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  }

  it('uses S3 when it is configured', () => {
    expect(objectStore({ ...s3Env, NODE_ENV: 'production' }).driver).toBe('s3')
  })

  it('falls back to the filesystem in development so uploads work with no credentials', () => {
    expect(objectStore({ NODE_ENV: 'development', STORAGE_DIR: root }).driver).toBe('local')
  })

  it('refuses the filesystem in production rather than silently losing uploads on redeploy', () => {
    expect(() => objectStore({ NODE_ENV: 'production' })).toThrow(/S3_/)
  })
})
