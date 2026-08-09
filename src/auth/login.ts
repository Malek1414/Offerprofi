/**
 * Login (F0.6).
 *
 * Two properties this file exists to hold, both of which are easy to lose in a
 * refactor and neither of which any user will ever report as broken:
 *
 *   1. **An unknown email costs the same time as a wrong password.** Without the
 *      dummy verification below, a missing account returns in a millisecond and a
 *      real one takes ~100ms of scrypt. That difference is measurable over the
 *      network, and it turns the login form into a "does this person have an
 *      account here" oracle — which, for a product whose customers are agencies,
 *      leaks the client list.
 *
 *   2. **One message for every failure.** "Unknown email" and "wrong password" are
 *      the same string to the user. The convenience of a precise error is worth
 *      less than the enumeration it hands out.
 *
 * The dummy hash is a real scrypt hash of a random value at current parameters, so
 * verifying against it does the same work as a genuine comparison. Hardcoding a
 * cheap constant would defeat the whole point.
 */

import type { PoolClient } from 'pg'

import { hashPassword, needsRehash, verifyPassword } from './password'
import { mintStaffSession, normaliseEmail, type MintedStaffSession } from './session'

export type LoginOutcome =
  | { status: 'ok'; userId: string; displayName: string; session: MintedStaffSession }
  /** Covers unknown email, wrong password and a corrupted hash, indistinguishably. */
  | { status: 'rejected' }

interface LoginRow {
  id: string
  password_hash: string
  display_name: string
}

/**
 * Lazily built, once per process. Building it costs one scrypt (~100ms) on the first
 * failed login rather than at import, so a cold start is not slowed by a code path
 * that may never run.
 */
let dummyHashPromise: Promise<string> | null = null

function dummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    // Random per process: a constant would be identical across deployments and could
    // be recognised, though nothing about the timing depends on the value.
    dummyHashPromise = hashPassword(`unused-${Math.random()}-${Date.now()}-padding`)
  }
  return dummyHashPromise
}

export interface LoginAttempt {
  email: string
  password: string
  userAgent?: string | null
  ip?: string | null
}

export async function login(
  client: PoolClient,
  attempt: LoginAttempt,
  now: Date = new Date(),
): Promise<LoginOutcome> {
  const email = normaliseEmail(attempt.email ?? '')
  const password = attempt.password ?? ''

  const found = await client.query<LoginRow>(
    'select id, password_hash, display_name from public.find_user_for_login($1)',
    [email],
  )
  const row = found.rows[0]

  if (!row) {
    // Do the work anyway. The result is discarded; the elapsed time is the point.
    await verifyPassword(password, await dummyHash())
    return { status: 'rejected' }
  }

  if (!(await verifyPassword(password, row.password_hash))) return { status: 'rejected' }

  // The only moment the plaintext is in hand, so the only moment the stored hash can
  // be brought up to current cost. Failing to upgrade must not fail the login — the
  // password was correct, and an unavailable write is our problem, not the owner's.
  if (needsRehash(row.password_hash)) {
    try {
      await client.query('select public.update_password_hash($1, $2)', [
        row.id,
        await hashPassword(password),
      ])
    } catch {
      // Deliberately swallowed. Logged by the caller's error handling if it recurs.
    }
  }

  const session = mintStaffSession(now)
  await client.query('select public.create_user_session($1, $2, $3, $4, $5)', [
    row.id,
    session.tokenHash,
    session.expiresAt.toISOString(),
    attempt.userAgent ?? null,
    attempt.ip ?? null,
  ])

  return { status: 'ok', userId: row.id, displayName: row.display_name, session }
}

/**
 * Resolve a staff cookie to a user id, or null.
 *
 * Everything authenticated starts here. It returns nothing — not an error — for an
 * expired or revoked session, so a caller cannot accidentally treat "session ended"
 * as a recoverable condition and retry into it.
 */
export async function resolveStaffSession(
  client: PoolClient,
  tokenHash: string,
): Promise<string | null> {
  const result = await client.query<{ resolve_user_session: string | null }>(
    'select public.resolve_user_session($1)',
    [tokenHash],
  )
  return result.rows[0]?.resolve_user_session ?? null
}

export async function revokeStaffSession(client: PoolClient, tokenHash: string): Promise<void> {
  await client.query('select public.revoke_user_session($1)', [tokenHash])
}
