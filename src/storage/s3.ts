/**
 * The S3 driver — production.
 *
 * Five HTTP verbs against an S3-compatible endpoint, signed by `./sigv4`. D29 says
 * S3-*compatible* rather than AWS, so this speaks the subset that Hetzner, Scaleway,
 * Cloudflare R2 and MinIO all implement, and addresses buckets **path-style**
 * (`endpoint/bucket/key`). Virtual-host style — `bucket.endpoint/key` — is the AWS
 * default and the thing most compatible providers do not do, so choosing it here would
 * have made the driver work against exactly one of the providers D29 leaves open.
 *
 * `fetch` is Node's built-in. There is no client object to construct, nothing to keep
 * warm, and no connection state to lose across a serverless invocation.
 */

import { assertSafeKey } from './keys'
import { signedHeaders } from './sigv4'
import type { ObjectStore, PutOptions, StoredObject, StoredObjectBody } from './types'

const EMPTY_PAYLOAD_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

export interface S3Config {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** Injected in tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch
  /** Injected in tests so a signature is reproducible. Defaults to the wall clock. */
  now?: () => Date
}

const hex = async (body: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', body as unknown as ArrayBuffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function s3ObjectStore(config: S3Config): ObjectStore {
  const doFetch = config.fetch ?? fetch
  const now = config.now ?? (() => new Date())
  const base = config.endpoint.replace(/\/+$/, '')

  const urlFor = (key: string): URL => {
    assertSafeKey(key)
    return new URL(`${base}/${config.bucket}/${key}`)
  }

  /**
   * Every request goes out through here, so the signature can never be forgotten on a
   * verb added later. `payloadHash` is required rather than defaulted: S3 signs the body
   * digest, and a wrong one fails with a 403 that says nothing about the real cause.
   */
  const send = async (
    method: string,
    url: URL,
    options: { body?: Uint8Array; headers?: Record<string, string>; payloadHash: string },
  ): Promise<Response> => {
    const headers = signedHeaders({
      method,
      url,
      headers: { 'x-amz-content-sha256': options.payloadHash, ...options.headers },
      payloadHash: options.payloadHash,
      region: config.region,
      service: 's3',
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      now: now(),
    })

    return doFetch(url, {
      method,
      headers,
      body: options.body as BodyInit | undefined,
    })
  }

  /**
   * A 404 is an answer; anything else in the 4xx/5xx range is a fault.
   *
   * Collapsing the two would make a permissions failure look like an absent object,
   * and B1's resumable upload asks "did this chunk already land?" by calling `head`.
   * Answering "no" to that question because the credentials are wrong would make the
   * client re-upload the whole file, forever, without ever reporting a problem.
   */
  const failure = async (response: Response, what: string): Promise<Error> => {
    const detail = await response.text().catch(() => '')
    return new Error(`s3: ${what} failed with ${response.status} ${response.statusText} ${detail}`.trim())
  }

  return {
    driver: 's3',

    async put(key: string, body: Uint8Array, options: PutOptions): Promise<StoredObject> {
      const response = await send('PUT', urlFor(key), {
        body,
        headers: { 'content-type': options.contentType, 'content-length': String(body.byteLength) },
        payloadHash: await hex(body),
      })
      if (!response.ok) throw await failure(response, `put ${key}`)
      return { key, size: body.byteLength, contentType: options.contentType }
    },

    async get(key: string): Promise<StoredObjectBody | null> {
      const response = await send('GET', urlFor(key), { payloadHash: EMPTY_PAYLOAD_SHA256 })
      if (response.status === 404) return null
      if (!response.ok) throw await failure(response, `get ${key}`)

      const body = new Uint8Array(await response.arrayBuffer())
      return {
        key,
        size: body.byteLength,
        contentType: response.headers.get('content-type') ?? 'application/octet-stream',
        body,
      }
    },

    async head(key: string): Promise<StoredObject | null> {
      const response = await send('HEAD', urlFor(key), { payloadHash: EMPTY_PAYLOAD_SHA256 })
      if (response.status === 404) return null
      if (!response.ok) throw await failure(response, `head ${key}`)

      return {
        key,
        size: Number(response.headers.get('content-length') ?? 0),
        contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      }
    },

    async delete(key: string): Promise<void> {
      const response = await send('DELETE', urlFor(key), { payloadHash: EMPTY_PAYLOAD_SHA256 })
      // S3 returns 204 for a delete of something that was never there. Both are success,
      // because the contract says a retried deletion must not fail.
      if (!response.ok && response.status !== 404) throw await failure(response, `delete ${key}`)
    },

    /**
     * ListObjectsV2, followed to the end.
     *
     * The continuation loop is not optional: S3 truncates at 1000 keys and signals it
     * with a flag rather than an error, so a single-request implementation silently
     * returns a partial answer. `list` is what the B3 deletion path enumerates, and a
     * deletion path that stops at 1000 objects leaves data behind while reporting success.
     */
    async list(prefix: string): Promise<string[]> {
      assertSafeKey(prefix.endsWith('/') ? `${prefix}_` : prefix)
      const keys: string[] = []
      let token: string | undefined

      do {
        const url = new URL(`${base}/${config.bucket}`)
        url.searchParams.set('list-type', '2')
        url.searchParams.set('prefix', prefix)
        if (token) url.searchParams.set('continuation-token', token)

        const response = await send('GET', url, { payloadHash: EMPTY_PAYLOAD_SHA256 })
        if (!response.ok) throw await failure(response, `list ${prefix}`)

        const xml = await response.text()
        for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
          keys.push(decodeEntities(match[1] ?? ''))
        }
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
          ? decodeEntities(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? '')
          : undefined
      } while (token)

      return keys.sort()
    },
  }
}

/**
 * Keys come back XML-escaped. Our own keys contain none of these characters — they are
 * a uuid, a scope from a closed list and a hex digest — but `list` is also how we find
 * out about objects we did not write, and decoding is cheaper than being surprised.
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}
