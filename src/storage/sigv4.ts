/**
 * AWS Signature Version 4, in about a hundred lines and no dependency.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS HAND-WRITTEN RATHER THAN `@aws-sdk/client-s3`.
 *
 * The SDK is ~20 MB of transitive dependency to send four HTTP verbs at a bucket,
 * and D29 says the store is S3-*compatible*, not AWS — Hetzner, Scaleway, Cloudflare
 * R2 and MinIO all speak this protocol, and the SDK's endpoint handling has to be
 * fought into path-style addressing for most of them. The signature algorithm itself
 * is fully specified and has published test vectors, which is exactly the kind of
 * thing that is safe to implement and dangerous to guess at. `tests/storage/sigv4.test.ts`
 * checks it against AWS's own `get-vanilla` case.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createHash, createHmac } from 'node:crypto'

const ALGORITHM = 'AWS4-HMAC-SHA256'

export interface CanonicalInput {
  method: string
  url: URL
  /** Any header name casing; `host` is filled in from the url when absent. */
  headers: Record<string, string>
  /** Hex sha256 of the request body. */
  payloadHash: string
}

export interface SignInput extends CanonicalInput {
  region: string
  service: string
  accessKeyId: string
  secretAccessKey: string
  now: Date
}

const hex = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex')
const hmac = (key: Uint8Array | string, data: string): Buffer =>
  createHmac('sha256', key).update(data, 'utf8').digest()

/**
 * AWS's escaping, which is RFC 3986 and *not* `encodeURIComponent`.
 *
 * The difference is small and total: `encodeURIComponent` leaves `!*'()` alone, AWS
 * expects them percent-encoded, and our own object keys are allowed to contain all
 * four. Getting this wrong produces a 403 on exactly the files whose names happen to
 * use them, which is the worst possible failure mode — intermittent and file-specific.
 */
function escape(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** Path segments are escaped individually so the separators survive. */
function canonicalUri(pathname: string): string {
  return pathname.split('/').map(escape).join('/') || '/'
}

function canonicalQuery(url: URL): string {
  const pairs: Array<[string, string]> = []
  url.searchParams.forEach((value, name) => pairs.push([escape(name), escape(value)]))
  pairs.sort(([a, aValue], [b, bValue]) => (a === b ? aValue.localeCompare(bValue) : a.localeCompare(b)))
  return pairs.map(([name, value]) => `${name}=${value}`).join('&')
}

function normaliseHeaders(input: CanonicalInput): Array<[string, string]> {
  const merged = new Map<string, string>()
  merged.set('host', input.url.host)
  for (const [name, value] of Object.entries(input.headers)) {
    // Sequential whitespace collapses because the server collapses it before it
    // recomputes the signature; leaving it would sign a string nobody else derives.
    merged.set(name.toLowerCase().trim(), String(value).trim().replace(/\s+/g, ' '))
  }
  return [...merged.entries()].sort(([a], [b]) => a.localeCompare(b))
}

export function canonicalRequest(input: CanonicalInput): string {
  const headers = normaliseHeaders(input)
  return [
    input.method.toUpperCase(),
    canonicalUri(input.url.pathname),
    canonicalQuery(input.url),
    ...headers.map(([name, value]) => `${name}:${value}`),
    '',
    headers.map(([name]) => name).join(';'),
    input.payloadHash,
  ].join('\n')
}

const amzDate = (now: Date): string => `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`

/**
 * The signing key is derived per day, per region, per service — never the secret
 * itself, and never reused across any of those three. That is the whole reason a
 * leaked signature is not a leaked credential.
 */
function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), 'aws4_request')
}

/**
 * Returns the headers to send: the caller's own, plus `x-amz-date` and `authorization`.
 */
export function signedHeaders(input: SignInput): Record<string, string> {
  const timestamp = amzDate(input.now)
  const date = timestamp.slice(0, 8)
  const scope = `${date}/${input.region}/${input.service}/aws4_request`

  const headers = { ...input.headers, 'x-amz-date': timestamp }
  const canonical = canonicalRequest({ ...input, headers })
  const signedNames = normaliseHeaders({ ...input, headers })
    .map(([name]) => name)
    .join(';')

  const stringToSign = [ALGORITHM, timestamp, scope, hex(canonical)].join('\n')
  const signature = hmac(
    signingKey(input.secretAccessKey, date, input.region, input.service),
    stringToSign,
  ).toString('hex')

  return {
    ...headers,
    authorization:
      `${ALGORITHM} Credential=${input.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedNames}, Signature=${signature}`,
  }
}
