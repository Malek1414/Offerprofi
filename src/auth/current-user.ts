/**
 * Reading the signed-in user in a server component or route handler (F0.6).
 *
 * The single entry point to "who is this request". Everything authenticated starts
 * here, and it returns the *user id only* — deliberately not the agency. Which
 * tenant's rows a user may see is decided by RLS from `app.current_user_id`
 * (src/db/client.ts), and a helper that also returned an agency id would invite
 * callers to filter in application code, which is the failure mode the whole RLS
 * arrangement exists to prevent.
 *
 * ─── Why there is no middleware ─────────────────────────────────────────────
 *
 * Next middleware runs on the edge runtime, where `node:crypto` and the `pg` driver
 * are unavailable, so a middleware-based guard could only inspect the *presence* of
 * a cookie — not whether the session behind it is still valid. That produces the
 * worst possible shape: a revoked member appears signed in, reaches a page, and is
 * only stopped when a query returns nothing. Guarding in the page, against the
 * database, means revocation takes effect on the very next request.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { asAnonymous, hasDatabase } from '../db/client'
import { resolveStaffSession } from './login'
import { hashStaffToken, STAFF_COOKIE_NAME } from './session'

/**
 * The signed-in user, or null.
 *
 * Returns null rather than throwing for every reason a request might be
 * unauthenticated — no cookie, unknown token, expired, revoked. The caller cannot
 * distinguish them, which is intended: there is nothing a page should do differently
 * for a revoked session than for an absent one.
 */
export async function currentUserId(): Promise<string | null> {
  if (!hasDatabase()) return null

  const store = await cookies()
  const token = store.get(STAFF_COOKIE_NAME)?.value
  if (!token) return null

  try {
    return await asAnonymous(async (client) => resolveStaffSession(client, hashStaffToken(token)))
  } catch {
    // A database outage signs everyone out rather than signing everyone in.
    return null
  }
}

/**
 * Require a signed-in user, or redirect to login.
 *
 * The `next` parameter carries the requested path so the owner lands where she was
 * going rather than on a dashboard she then has to navigate out of. It is
 * path-relative and validated at the login screen, because an open redirect here
 * would let a phishing link send someone to an attacker's site *through* our
 * domain, which is exactly the pattern that makes a login page credible.
 */
export async function requireUserId(next?: string): Promise<string> {
  const userId = await currentUserId()
  if (userId) return userId
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : undefined
  redirect(target ? `/login?next=${encodeURIComponent(target)}` : '/login')
}
