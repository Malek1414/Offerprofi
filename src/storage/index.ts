/**
 * Choosing a driver, and the deletion path B3 requires.
 *
 * The whole of Phase B imports `objectStore()` and never a driver directly, so which
 * one is in use is a deployment fact rather than a code fact. Two rules decide it, and
 * the second one is the important one:
 *
 *  1. If S3 is fully configured, use S3 — in development too. A developer who has
 *     credentials should be exercising the driver that production runs.
 *  2. **In production, the filesystem is refused rather than used as a fallback.**
 *     A container filesystem is wiped on redeploy, so falling back would mean uploads
 *     that succeed, report success, and are gone the next morning with no error anywhere.
 *     Failing at startup is loud, immediate, and fixable; the alternative is silent
 *     data loss discovered by a customer.
 */

import { agencyPrefix } from './keys'
import { localObjectStore } from './local'
import { s3ObjectStore } from './s3'
import type { ObjectStore } from './types'

export { agencyPrefix, objectKey, sha256, assertSafeKey } from './keys'
export { localObjectStore } from './local'
export { s3ObjectStore } from './s3'
export type { ObjectStore, PutOptions, StoredObject, StoredObjectBody } from './types'
export type { StorageScope } from './keys'

type Env = Record<string, string | undefined>

const S3_VARIABLES = [
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
] as const

export function objectStore(env: Env = process.env): ObjectStore {
  const missing = S3_VARIABLES.filter((name) => !env[name])

  if (missing.length === 0) {
    return s3ObjectStore({
      endpoint: env.S3_ENDPOINT!,
      region: env.S3_REGION!,
      bucket: env.S3_BUCKET!,
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    })
  }

  if (env.NODE_ENV === 'production') {
    throw new Error(
      `objectStore: object storage is not configured — missing ${missing.join(', ')}. ` +
        'The filesystem driver is not available in production: a container filesystem is ' +
        'erased on redeploy, so uploads would appear to succeed and then be gone.',
    )
  }

  return localObjectStore(env.STORAGE_DIR ?? '.storage')
}

/**
 * Remove every object one agency owns, and report how many.
 *
 * B3 requires that a prospect record and everything derived from it be removable on
 * request, and §9 records why: a sole trader's public business page is personal data
 * under GDPR because the natural person *is* the business. The count comes back so the
 * caller can write down what was actually deleted — an erasure request answered with
 * "done" and no number is not evidence of anything.
 *
 * Deletion is sequential rather than concurrent on purpose. This runs rarely, and a
 * partial failure halfway through a `Promise.all` leaves an unknown set removed; here,
 * everything before the failure is gone and the count says how far it got.
 */
export async function deleteAgencyObjects(store: ObjectStore, agencyId: string): Promise<number> {
  const keys = await store.list(agencyPrefix(agencyId))
  let removed = 0
  for (const key of keys) {
    await store.delete(key)
    removed += 1
  }
  return removed
}
