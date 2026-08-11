/**
 * The filesystem driver — development, and tests.
 *
 * It exists so that Phase B can be built and demonstrated with no credentials at all.
 * A storage layer that only works once someone has provisioned a bucket is a storage
 * layer nobody exercises until the day it matters.
 *
 * It is **not** a production driver, and `objectStore()` refuses to hand it out in
 * production: a container filesystem is erased on every redeploy, and the failure is
 * silent — uploads appear to work and are simply gone the next morning.
 *
 * The content type is kept in a sidecar file rather than guessed from the extension on
 * the way out. The extension in a key comes from a closed allowlist and falls back to
 * `.bin`, so guessing would return `application/octet-stream` for a perfectly good PDF.
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

import { assertSafeKey } from './keys'
import type { ObjectStore, PutOptions, StoredObject, StoredObjectBody } from './types'

const META_SUFFIX = '.meta.json'

export function localObjectStore(root: string): ObjectStore {
  const base = resolve(root)

  /**
   * Two independent checks, because this is the boundary where a bad key becomes a
   * write to an arbitrary path. `assertSafeKey` rejects the shape; resolving and
   * re-checking the prefix catches anything the shape check did not anticipate —
   * symlinked segments, platform-specific separators, encodings not thought of.
   */
  const pathFor = (key: string): string => {
    assertSafeKey(key)
    const full = resolve(base, key)
    if (full !== base && !full.startsWith(base + sep)) {
      throw new Error(`storage key: path traversal in ${key}`)
    }
    return full
  }

  const readMeta = async (path: string): Promise<{ contentType: string } | null> => {
    try {
      return JSON.parse(await readFile(`${path}${META_SUFFIX}`, 'utf8')) as { contentType: string }
    } catch {
      return null
    }
  }

  return {
    driver: 'local',

    async put(key: string, body: Uint8Array, options: PutOptions): Promise<StoredObject> {
      const path = pathFor(key)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, body)
      await writeFile(`${path}${META_SUFFIX}`, JSON.stringify({ contentType: options.contentType }))
      return { key, size: body.byteLength, contentType: options.contentType }
    },

    async get(key: string): Promise<StoredObjectBody | null> {
      const path = pathFor(key)
      let body: Buffer
      try {
        body = await readFile(path)
      } catch {
        return null
      }
      const meta = await readMeta(path)
      return {
        key,
        size: body.byteLength,
        contentType: meta?.contentType ?? 'application/octet-stream',
        body: new Uint8Array(body),
      }
    },

    async head(key: string): Promise<StoredObject | null> {
      const path = pathFor(key)
      try {
        const stats = await stat(path)
        const meta = await readMeta(path)
        return { key, size: stats.size, contentType: meta?.contentType ?? 'application/octet-stream' }
      } catch {
        return null
      }
    },

    async delete(key: string): Promise<void> {
      const path = pathFor(key)
      await rm(path, { force: true })
      await rm(`${path}${META_SUFFIX}`, { force: true })
    },

    async list(prefix: string): Promise<string[]> {
      assertSafeKey(prefix.endsWith('/') ? `${prefix}_` : prefix)
      const keys: string[] = []

      const walk = async (relative: string): Promise<void> => {
        let entries
        try {
          entries = await readdir(join(base, relative), { withFileTypes: true })
        } catch {
          return
        }
        for (const entry of entries) {
          const child = relative ? `${relative}/${entry.name}` : entry.name
          if (entry.isDirectory()) await walk(child)
          else if (!child.endsWith(META_SUFFIX) && child.startsWith(prefix)) keys.push(child)
        }
      }

      await walk('')
      return keys.sort()
    },
  }
}
