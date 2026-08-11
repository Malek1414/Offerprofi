/**
 * Where an object lives, derived from what it is.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A FILENAME NEVER DECIDES A PATH.
 *
 * Filenames arrive from an upload form, which means from whoever is uploading.
 * `objectKey` reads exactly one thing out of a filename — the extension, and only
 * from a closed list — and discards the rest. Everything structural in the key comes
 * from values we already hold: the agency id, a scope this code chose, and a digest
 * this code computed.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The key is content-addressed because B1 asks for re-uploading a file to be a no-op
 * rather than a duplicate. A digest gives that for free and without a round trip: the
 * same bytes compute the same key, so the second upload overwrites the first byte for
 * byte. A timestamp or a random id in the key would quietly remove that property.
 */

import { createHash } from 'node:crypto'

/** Scopes are a closed set because each one carries a different retention promise. */
export type StorageScope =
  /** Spreadsheets and documents of prospect businesses (Phase B). Retained. */
  | 'prospect-import'
  /** Crawled pages and assets held for enrichment (Phase C). Retained, deletable. */
  | 'prospect-source'
  /** Agency logos and brand assets. Retained for as long as the tenant exists. */
  | 'brand-asset'

const SCOPES: ReadonlySet<string> = new Set<StorageScope>([
  'prospect-import',
  'prospect-source',
  'brand-asset',
])

/**
 * The types D2 commits to on the client side. An extension outside this list is not
 * an error — the file is still stored — it simply does not get to name itself, so a
 * `.exe` or a `.php` cannot ride along on a key and be served back as one later.
 */
const EXTENSIONS: ReadonlySet<string> = new Set([
  'pdf', 'docx', 'xlsx', 'csv', 'txt', 'md', 'json',
  'png', 'jpg', 'jpeg', 'heic', 'webp',
])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/

export interface ObjectKeyInput {
  agencyId: string
  scope: StorageScope
  /** Lowercase hex sha256 of the object's bytes — see `sha256`. */
  sha256: string
  /** Only the extension is read. The name is discarded. */
  filename: string
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot <= 0 || dot === filename.length - 1) return 'bin'
  const candidate = filename.slice(dot + 1).toLowerCase()
  return EXTENSIONS.has(candidate) ? candidate : 'bin'
}

export function objectKey(input: ObjectKeyInput): string {
  if (!UUID.test(input.agencyId)) {
    throw new Error(`objectKey: agency id is not a uuid: ${JSON.stringify(input.agencyId)}`)
  }
  if (!SHA256.test(input.sha256)) {
    throw new Error(`objectKey: sha256 must be 64 lowercase hex characters`)
  }
  if (!SCOPES.has(input.scope)) {
    throw new Error(`objectKey: unknown scope ${JSON.stringify(input.scope)}`)
  }
  return `a/${input.agencyId.toLowerCase()}/${input.scope}/${input.sha256}.${extensionOf(input.filename)}`
}

/**
 * The prefix holding everything one agency owns.
 *
 * B3 requires a deletion path — a prospect record and everything derived from it must
 * be removable on request — and a deletion path needs a way to name the whole set.
 */
export function agencyPrefix(agencyId: string): string {
  if (!UUID.test(agencyId)) {
    throw new Error(`agencyPrefix: agency id is not a uuid: ${JSON.stringify(agencyId)}`)
  }
  return `a/${agencyId.toLowerCase()}/`
}

/**
 * Defence in depth for keys the store did not derive itself.
 *
 * `objectKey` cannot produce anything unsafe, but a store must not assume its caller
 * used it — a key read back out of a database row has been through a system that could
 * have been wrong. This is the check that runs at the door of every driver.
 */
export function assertSafeKey(key: string): void {
  if (!key || key.length > 512) throw new Error('storage key: empty or too long')
  if (!/^[A-Za-z0-9!_.*'()/-]+$/.test(key)) throw new Error(`storage key: illegal characters in ${key}`)
  if (key.startsWith('/') || key.includes('//')) throw new Error(`storage key: not a relative path: ${key}`)
  if (key.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`storage key: path traversal in ${key}`)
  }
}
