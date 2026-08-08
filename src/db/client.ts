/**
 * Postgres access (decision D15).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE IS WHAT MAKES ROW LEVEL SECURITY REAL.
 *
 * The RLS policies in db/migrations/0002 are written against
 * `public.current_user_id()`, which reads the `app.current_user_id` setting on the
 * connection. Nothing sets that automatically — on a managed platform the identity
 * arrives inside a JWT and the database extracts it, but on plain Postgres it is the
 * application's job, and getting it wrong is a cross-tenant data leak rather than an
 * error anyone would notice.
 *
 * Two failure modes this file exists to prevent:
 *
 *   1. **Forgetting to set the identity.** Then `current_user_id()` is NULL, every
 *      policy denies, and queries come back empty. Loud and safe — the good failure.
 *   2. **A pooled connection carrying the previous request's identity.** Silent, and
 *      it serves one tenant's inquiries to another. Prevented by setting the value
 *      with `set_local` *inside a transaction*, so Postgres discards it at commit or
 *      rollback. There is no code path here that sets it outside one.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Pool, type PoolClient } from 'pg'

let pool: Pool | null = null

/**
 * The shared pool.
 *
 * `DATABASE_URL` must point at a role that inherits `app_user` — a role with
 * BYPASSRLS (the database owner, typically) would silently disable every policy in
 * the product while all the tests still pass.
 */
export function getPool(): Pool {
  if (pool) return pool
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set')

  pool = new Pool({
    connectionString,
    max: Number(process.env.PGPOOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    // A query that has not returned in 15 seconds is not going to. Failing lets the
    // customer see an error and retry, which beats a chat turn that never resolves.
    statement_timeout: 15_000,
  })
  return pool
}

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL)
}

/**
 * Run queries as a specific user, inside a transaction.
 *
 * Every read or write on behalf of a logged-in agency member goes through here. The
 * callback receives a client whose `app.current_user_id` is set, so RLS resolves the
 * tenant without any query needing to mention `agency_id` — which is the point:
 * a forgotten `where agency_id = $1` stops being a security bug.
 */
export async function withUser<T>(
  userId: string,
  fn: (_client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!userId) throw new Error('withUser requires a user id')
  const client = await getPool().connect()
  try {
    await client.query('begin')
    // Parameterised, not interpolated. `set_local` does not accept a placeholder in
    // its usual form, so the value goes through set_config, which does.
    await client.query('select set_config($1, $2, true)', ['app.current_user_id', userId])
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

/**
 * Run queries with no user identity.
 *
 * For the genuinely public paths: resolving `/a/{slug}` to a tenant before anyone
 * has authenticated, and resolving a tokenised quote link. Under RLS these see
 * nothing, so the queries they run must be against the small number of tables that
 * are deliberately readable without an identity, or run through a SECURITY DEFINER
 * function that returns exactly the columns a stranger may see.
 *
 * Named `asAnonymous` rather than something neutral so that a reviewer noticing it
 * in a file that handles agency data knows immediately that it is wrong there.
 */
export async function asAnonymous<T>(fn: (_client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}

/** Close the pool. For tests and graceful shutdown. */
export async function closePool(): Promise<void> {
  if (!pool) return
  await pool.end()
  pool = null
}
