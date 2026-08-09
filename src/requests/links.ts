/**
 * The two links a sent request produces (Phase D).
 *
 * One request, two documents, two tokens. Hers confirms what she asked for; his is
 * the same request plus what he needs to answer it — and, once Phase B2 lands, a
 * suggested price with his margin on it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TOKEN IS THE ONLY CREDENTIAL, SO IT IS SIZED LIKE ONE.
 *
 * The customer has no account and never will (D11), which makes the token the
 * whole of the authorisation. 32 random bytes, base64url, and only its SHA-256
 * digest is stored — so a leaked database backup is a list of hashes rather than a
 * list of working links into strangers' enquiries.
 *
 * The owner's token is separately minted from hers. Deriving one from the other,
 * however cleverly, would mean a customer who has her own link holds the input to
 * his.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createHash, randomBytes } from 'node:crypto'

/** Who a link is for. Two documents from one route. */
export type RequestAudience = 'customer' | 'owner'

export interface MintedLink {
  /** Goes in the URL. Never stored. */
  token: string
  /** Stored. Never leaves the server. */
  tokenHash: string
}

export function mintRequestToken(): MintedLink {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashRequestToken(token) }
}

export function hashRequestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Cheap shape check before any database round trip.
 *
 * A token that cannot have been minted here is not looked up — which keeps the
 * lookup path from being a free oracle for anyone spraying `/r/…`, and keeps
 * garbage out of the query planner.
 */
export function isPlausibleRequestToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{40,64}$/.test(token)
}

/** The path a document lives at. Relative, so it works on any host we are served from. */
export function requestPath(token: string): string {
  return `/r/${token}`
}
