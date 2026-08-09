/**
 * POST /api/auth/login (F0.6).
 *
 * One failure message for every failure. Unknown email, wrong password and a
 * corrupted stored hash are the same response with the same status and — because of
 * the dummy verification in src/auth/login.ts — very nearly the same duration.
 *
 * The throttle is keyed on **both** the address and the IP. Either alone is
 * insufficient: keying only on IP lets a botnet spread guesses against one account
 * across thousands of addresses, and keying only on the email lets an attacker lock
 * a known owner out of her own dashboard on the morning she needs it.
 */

import { type NextRequest } from 'next/server'

import { asAnonymous, hasDatabase } from '../../../../db/client'
import { login } from '../../../../auth/login'
import { normaliseEmail, serializeStaffCookie, staffCookieOptions } from '../../../../auth/session'
import { AuthThrottle } from '../../../../auth/throttle'

export const runtime = 'nodejs'

const throttle = new AuthThrottle()

export async function POST(request: NextRequest): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ status: 'rejected' }, 400)
  }

  const input = body as Record<string, unknown>
  const email = normaliseEmail(String(input.email ?? ''))
  const password = String(input.password ?? '')
  const ip = clientIp(request)

  for (const key of [`login:email:${email}`, `login:ip:${ip}`]) {
    const decision = throttle.check(key)
    if (decision.outcome === 'refuse') {
      return json({ status: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds }, 429, {
        'retry-after': String(decision.retryAfterSeconds),
      })
    }
  }

  if (!email || !password) return json({ status: 'rejected' }, 401)

  if (!hasDatabase()) return json({ status: 'unavailable' }, 503)

  const outcome = await asAnonymous(async (client) =>
    login(client, { email, password, userAgent: request.headers.get('user-agent'), ip }),
  )

  if (outcome.status !== 'ok') return json({ status: 'rejected' }, 401)

  // Succeeding clears the backoff, so an owner who mistyped four times and then got
  // it right is not left waiting as though she had failed.
  throttle.clear(`login:email:${email}`)
  throttle.clear(`login:ip:${ip}`)

  return json({ status: 'ok', displayName: outcome.displayName }, 200, {
    'set-cookie': serializeStaffCookie(
      outcome.session.token,
      staffCookieOptions(request.nextUrl.protocol === 'https:'),
    ),
  })
}

function json(payload: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  return forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
}
