/**
 * The chat message endpoint (F1.6, F1.7, F1.9).
 *
 * POST a turn, get an SSE stream back. The stream is the point: the customer sees
 * the first words within a few hundred milliseconds instead of watching a spinner
 * for the length of the whole reply. "Blank wait state" is the failure mode F1.7
 * names explicitly.
 *
 * The ordering enforced here is the one the product's core promise rests on
 * (F1.9): **acknowledge, then work.** The acknowledgement is deterministic text
 * that needs no model and no database read, so it goes out first and extraction is
 * scheduled behind it. Anything added to this handler that must complete before the
 * first chunk is written is a regression in the metric that wins deals.
 */

import { type NextRequest } from 'next/server'

import { acknowledgeInquiry } from '../../../../chat/ack'
import { triageInbound } from '../../../../chat/abuse'
import { composeAgentTurns, streamChunks } from '../../../../chat/conversation'
import { RateLimiter } from '../../../../chat/rate-limit'
import {
  SESSION_COOKIE_NAME,
  mintSession,
  sessionCookieOptions,
  signSessionCookie,
  verifySessionCookie,
} from '../../../../chat/session'
import { hostedChatAdapter } from '../../../../channels/adapters/hosted-chat'
import { detectLanguageAndFormality, resolveVoice } from '../../../../i18n/detect'
import { resolveAgencyBySlug } from '../../../../lib/agency'

// Node runtime: the session HMAC uses node:crypto, and the handler is not on a
// latency path where the edge would help — the ack is composed locally either way.
export const runtime = 'nodejs'

/**
 * Process-local limiter.
 *
 * Correct for a single instance and honest about it: with more than one instance
 * this under-counts, because each holds its own map. That is an acceptable Phase 1
 * position precisely because the limiter only throttles and never refuses (see
 * rate-limit.ts) — the worst case of under-counting is that a burst is answered
 * promptly. Swap for a shared store before it guards anything with teeth.
 */
const limiter = new RateLimiter()

function sessionSecret(): string {
  const secret = process.env.CHAT_SESSION_SECRET
  if (!secret) {
    // Fail loudly rather than signing with a default. A predictable signing key is
    // no signing key, and the failure would be invisible in production.
    throw new Error('CHAT_SESSION_SECRET is not set')
  }
  return secret
}

interface ChatRequestBody {
  turnId?: unknown
  text?: unknown
  /** F1.11 — hidden from humans by CSS; a bot fills it in. */
  honeypot?: unknown
  /** F1.11 — milliseconds from render to submit. */
  timeToSubmitMs?: unknown
  /** F1.14 — the customer tapped "mit {Owner} sprechen". */
  requestHuman?: unknown
  clientSentAt?: unknown
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params

  // F1.4 — the tenant comes from the path, resolved server-side. Nothing in the
  // request body is consulted for it, now or downstream.
  const agency = await resolveAgencyBySlug(slug)
  if (!agency) return new Response('Not found', { status: 404 })

  let body: ChatRequestBody
  try {
    body = (await request.json()) as ChatRequestBody
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  const text = typeof body.text === 'string' ? body.text : ''
  const turnId = typeof body.turnId === 'string' && body.turnId ? body.turnId : crypto.randomUUID()
  const requestHuman = body.requestHuman === true

  if (!text.trim() && !requestHuman) {
    return new Response('Bad request', { status: 400 })
  }

  // Session: resume the signed cookie, or mint one. The raw token never leaves the
  // cookie; only its digest would be stored (F1.5).
  const secret = sessionSecret()
  const existingToken = verifySessionCookie(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
    secret,
  )
  const now = new Date()
  const minted = existingToken ? null : mintSession(now)
  const token = existingToken ?? (minted as NonNullable<typeof minted>).token
  // Session id for this turn. With a database this is the chat_sessions row id;
  // until then the token digest stands in, which keeps per-session counting honest.
  const sessionId = token.slice(0, 22)

  // F1.6 — throttling only. This can never drop the customer's message.
  const rate = limiter.check(sessionId, clientIp(request), now)
  if (rate.logLine) console.warn(rate.logLine)

  // F1.15 — mirror the customer, unless the agency has overridden.
  const detection = detectLanguageAndFormality(text)
  const voice = resolveVoice(detection, {
    language: agency.defaultLanguage,
    formality: agency.defaultFormality,
    ...(agency.forceFormality ? { forceFormality: agency.forceFormality } : {}),
  })

  // F1.11 — routes to a tray, never away. Two outcomes only.
  const triage = triageInbound({
    honeypotValue: typeof body.honeypot === 'string' ? body.honeypot : null,
    timeToSubmitMs: typeof body.timeToSubmitMs === 'number' ? body.timeToSubmitMs : null,
    text,
    // Wired to real counts when the database exists; the cap must hold the send and
    // escalate, never refuse (FEATURE_INVENTORY §16.1).
    agencyInquiriesToday: 0,
    agencyDailyCap: 200,
  })

  // F1.1/F1.3 — the canonical envelope. Everything downstream reads this and never
  // the request body.
  const event = hostedChatAdapter.toInboundEvent(
    {
      turnId,
      sessionId,
      text,
      clientSentAt: typeof body.clientSentAt === 'string' ? body.clientSentAt : undefined,
    },
    {
      agencyId: agency.id,
      now: now.toISOString(),
      newId: () => crypto.randomUUID(),
    },
  )

  // TODO(Phase 1, database): persist the envelope idempotently on
  // idempotencyKey, upsert the inquiry and write the message row. The unique index
  // on messages.external_message_id is what actually makes replay a no-op.
  void event

  const ack = acknowledgeInquiry({
    agencyName: agency.name,
    ownerName: agency.ownerName,
    language: voice.language,
    formality: voice.formality,
    privacyNoticeUrl: agency.privacyNoticeUrl,
    slaHours: agency.slaHours,
    routedToOwner: triage.handling === 'owner_tray',
    automationPaused: requestHuman,
  })

  const turns = composeAgentTurns({
    isFirstTurn: !existingToken,
    ack,
    triage,
    rate,
    language: voice.language,
    formality: voice.formality,
    automationPaused: requestHuman,
  })

  const stream = streamTurns(turns)

  const headers = new Headers({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Proxies that buffer would defeat the entire point of streaming.
    'X-Accel-Buffering': 'no',
  })

  const response = new Response(stream, { headers })
  if (minted) {
    response.headers.append(
      'Set-Cookie',
      serializeCookie(
        SESSION_COOKIE_NAME,
        signSessionCookie(minted.token, secret),
        sessionCookieOptions(request.nextUrl.protocol === 'https:'),
      ),
    )
  }
  return response
}

/** SSE frames: one `turn` event per message, `chunk` events inside it, then `done`. */
function streamTurns(turns: { kind: string; text: string }[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      try {
        for (const turn of turns) {
          send('turn', { kind: turn.kind })
          for (const chunk of streamChunks(turn.text)) {
            send('chunk', { text: chunk })
            // A short pause per chunk so the text arrives at a readable pace rather
            // than in one frame. Cosmetic now; when Phase 3 puts a model behind this
            // the cadence comes from the model and this goes away.
            await sleep(12)
          }
          send('turn_end', { kind: turn.kind })
        }
        send('done', {})
      } catch (error) {
        send('error', { message: error instanceof Error ? error.message : 'stream failed' })
      } finally {
        controller.close()
      }
    },
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Client IP for the per-IP counter.
 *
 * Only meaningful behind a proxy we control, which sets these headers. Treated as a
 * hint, not an identity — it feeds a counter whose worst outcome is a short delay,
 * so a spoofed value cannot deny anyone anything.
 */
function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null
  return request.headers.get('x-real-ip')
}

function serializeCookie(
  name: string,
  value: string,
  options: ReturnType<typeof sessionCookieOptions>,
): string {
  const parts = [`${name}=${value}`, `Path=${options.path}`, `Max-Age=${options.maxAge}`]
  if (options.httpOnly) parts.push('HttpOnly')
  if (options.secure) parts.push('Secure')
  parts.push(`SameSite=${options.sameSite === 'lax' ? 'Lax' : 'Strict'}`)
  return parts.join('; ')
}
