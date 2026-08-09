/**
 * POST /api/auth/logout (F0.6).
 *
 * Revokes the database row *and then* clears the cookie, in that order. Clearing a
 * cookie the client controls is not, on its own, ending a session — a copy taken
 * before sign-out would keep working until expiry. The row is the session; the cookie
 * is only how it is presented.
 *
 * POST rather than GET, so a `<img src="/api/auth/logout">` on any page cannot sign
 * an owner out. Combined with the staff cookie's `SameSite=Strict`, a cross-site
 * request cannot reach this at all.
 */

import { type NextRequest } from 'next/server'

import { asAnonymous, hasDatabase } from '../../../../db/client'
import { revokeStaffSession } from '../../../../auth/login'
import { clearStaffCookie, hashStaffToken, STAFF_COOKIE_NAME } from '../../../../auth/session'

export const runtime = 'nodejs'

export async function POST(request: NextRequest): Promise<Response> {
  const token = request.cookies.get(STAFF_COOKIE_NAME)?.value

  if (token && hasDatabase()) {
    try {
      await asAnonymous(async (client) => revokeStaffSession(client, hashStaffToken(token)))
    } catch {
      // A database that is down must not trap someone in a signed-in state. The
      // cookie is cleared regardless; the row expires on its own within seven days.
    }
  }

  return new Response(JSON.stringify({ status: 'ok' }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': clearStaffCookie(request.nextUrl.protocol === 'https:'),
    },
  })
}
