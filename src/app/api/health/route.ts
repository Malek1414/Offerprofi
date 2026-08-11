/**
 * `GET /api/health` — is this container actually able to serve?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT CHECKS THE DATABASE, AND THAT IS THE WHOLE REASON IT EXISTS.
 *
 * A TCP probe, or a route that returns `{ ok: true }` unconditionally, passes for
 * a Node process that is listening and has lost its connection pool — which is
 * the most common way this product would actually be down. The orchestrator would
 * then keep routing customers to a container that answers every request with an
 * error, and nothing would restart it.
 *
 * So the check is a round trip. `select 1` is cheap enough to run every thirty
 * seconds forever and is the only statement that proves the pool is alive, the
 * credentials still work and the database is reachable from here.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * It deliberately reports nothing about *what* is wrong. This endpoint is
 * reachable from the internet, and a health check that names the failing host or
 * quotes a driver error is free reconnaissance.
 */

import { asAnonymous, hasDatabase } from '../../../db/client'

export const runtime = 'nodejs'
// Never cached. A cached health check is a health check that reports the past.
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  if (!hasDatabase()) {
    // No DATABASE_URL is a deployment that was never finished. Reporting healthy
    // would let it take traffic.
    return Response.json({ status: 'unconfigured' }, { status: 503 })
  }

  try {
    await asAnonymous((client) => client.query('select 1'))
    return Response.json({ status: 'ok' })
  } catch {
    return Response.json({ status: 'degraded' }, { status: 503 })
  }
}
