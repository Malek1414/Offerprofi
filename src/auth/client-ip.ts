/**
 * The client address, as far as it can be trusted — which is not very far.
 *
 * `x-forwarded-for` is set by the client unless something in front overwrites it.
 * Behind our deployment platform it is overwritten, so the value is real; run
 * directly, with no proxy, anyone can pick their own. That is why this is used for
 * exactly two things and no others:
 *
 *   - **Rate-limit bucketing.** Spoofable, and it does not matter as much as it looks,
 *     because the auth throttle keys on the *email address* as well. Rotating the
 *     header buys a fresh IP bucket but not a fresh account bucket, so guessing at one
 *     account stays slow no matter how many addresses an attacker claims. That is the
 *     defence, and the IP key is a convenience on top of it.
 *   - **Session provenance**, for the account-activity view and incident response.
 *     Recorded, never trusted.
 *
 * It is never used for authorisation, and never for deciding what a request may see.
 * Extracted into one file so that stays reviewable in one place rather than being
 * copied into each new endpoint with the reasoning left behind.
 */

import type { NextRequest } from 'next/server'

export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  // The left-most entry is the original client behind a single trusted proxy. With
  // several, the trustworthy entry is counted from the right — a deployment detail,
  // and one worth revisiting if the topology ever gains a second hop.
  return forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
}
