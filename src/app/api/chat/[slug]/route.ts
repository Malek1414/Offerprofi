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
 * that needs no model and no database read, so it goes out first; the write, the
 * extraction and the qualifying question all happen behind it, on the same
 * connection, while she is still reading. Anything added to this handler that must
 * complete before the first chunk is written is a regression in the metric that
 * wins deals.
 *
 * Everything the model says arrives through `runQualifyingTurn`, which cannot fail
 * in a way the customer sees as a refusal — the worst case it can produce is "a
 * person is taking over" (I1, I5).
 */

import { type NextRequest } from 'next/server'

import { acknowledgeInquiry } from '../../../../chat/ack'
import { triageInbound } from '../../../../chat/abuse'
import { type AgentTurn, composeAgentTurns, streamChunks } from '../../../../chat/conversation'
import { RateLimiter } from '../../../../chat/rate-limit'
import { recordChatTurnDetached } from '../../../../chat/persistence'
import { runQualifyingTurn } from '../../../../chat/qualifying-turn'
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  hashSessionToken,
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

  // Whether a model may answer at all on this turn. Two cases where it may not,
  // and neither of them is a refusal: the customer has asked for a person (I5), or
  // triage has routed the turn to the owner's tray (F1.11), which is where a
  // suspected bot belongs — and paying for two model calls on its behalf is not.
  const agentMayAnswer = !requestHuman && triage.handling !== 'owner_tray'

  // F1.5 / F1.8 / F1.1 — written down *behind* the acknowledgement, never in front
  // of it. `streamTurns` calls this once the first chunk is on the wire, so a slow
  // database cannot move the metric F1.9 exists to protect. The token hash is the
  // session identity; the raw token stays in the cookie and is never stored.
  //
  // The qualifying loop chains off this one promise rather than starting its own:
  // extraction needs the inquiry id, and a second write would give the same thread
  // a second inquiry.
  const persist = () =>
    recordChatTurnDetached({
      agencyId: agency.id,
      sessionTokenHash: minted ? minted.tokenHash : hashSessionToken(token),
      // A returning customer's window is extended from this turn, so a conversation
      // she keeps coming back to does not expire underneath her mid-thread.
      resumableUntil:
        minted?.resumableUntil ?? new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
      // The envelope's key, not the client's turn id — the adapter is what decides
      // what counts as one message, and the unique index is on this value.
      externalMessageId: event.idempotencyKey,
      bodyText: text,
      // Only on the turn that actually showed it. `composeAgentTurns` leads with the
      // disclosure exactly when this is the first turn, so the two agree by
      // construction rather than by two separate conditions drifting apart.
      ...(turns.some((t) => t.kind === 'disclosure')
        ? {
            disclosure: {
              version: ack.disclosure.version,
              language: voice.language,
              formality: voice.formality,
              textShown: ack.disclosure.openingLine,
            },
          }
        : {}),
    })

  /**
   * The model's half of the turn.
   *
   * Started once the acknowledgement is on the wire and awaited only after every
   * deterministic turn has streamed, so the two model calls inside it sit behind a
   * typing indicator rather than in front of the customer's first words.
   *
   * It never throws: `runQualifyingTurn` answers every failure with a handoff turn,
   * and the guard here covers the one thing it cannot — a fault in the persistence
   * promise itself. An empty array simply ends the stream after the ack, which is
   * the Phase 1 behaviour and a fine floor to fall back to.
   */
  const followUp = async (persisted: ReturnType<typeof persist>): Promise<AgentTurn[]> => {
    if (!agentMayAnswer) return []
    try {
      const written = await persisted
      return await runQualifyingTurn({
        agencyId: agency.id,
        agencyName: agency.name,
        ownerName: agency.ownerName,
        inquiryId: written?.inquiryId ?? null,
        message: { id: event.idempotencyKey, text },
        language: voice.language,
        formality: voice.formality,
      })
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'qualifying_turn_failed',
          agencyId: agency.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      )
      return []
    }
  }

  const stream = streamTurns(turns, persist, followUp)

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

/**
 * SSE frames: one `turn` event per message, `chunk` events inside it, then `done`.
 *
 * `afterFirstChunk` runs once, immediately after the customer has something on
 * screen. That is the ordering F1.9 requires — anything slow belongs behind it, and
 * putting the hook here rather than at the call site means it cannot accidentally be
 * awaited before the stream is returned.
 *
 * `followUp` receives that same promise and produces the model-written turns, which
 * are streamed after the deterministic ones on the same connection. It is *started*
 * at the first chunk and *awaited* at the end, so the model works while the
 * acknowledgement is still being typed out rather than after it — and if it returns
 * nothing, the stream simply closes where Phase 1 closed it.
 */
function streamTurns<T>(
  turns: { kind: string; text: string }[],
  afterFirstChunk: () => Promise<T>,
  followUp?: (_persisted: Promise<T>) => Promise<{ kind: string; text: string }[]>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      let pending: Promise<{ kind: string; text: string }[]> | null = null
      try {
        let started = false
        const stream = async (batch: { kind: string; text: string }[]) => {
          for (const turn of batch) {
            send('turn', { kind: turn.kind })
            for (const chunk of streamChunks(turn.text)) {
              send('chunk', { text: chunk })
              if (!started) {
                started = true
                const persisted = afterFirstChunk()
                // Kicked off here and collected below. Not awaited: the whole point
                // of the ordering is that the customer reads while this runs.
                pending = followUp ? followUp(persisted) : null
              }
              // A short pause per chunk so the text arrives at a readable pace rather
              // than in one frame.
              await sleep(12)
            }
            send('turn_end', { kind: turn.kind })
          }
        }

        await stream(turns)
        // Nothing deterministic had any text to send — so the hook has not fired,
        // and the customer's message would otherwise never be written down.
        if (!started) {
          started = true
          const persisted = afterFirstChunk()
          pending = followUp ? followUp(persisted) : null
        }
        if (pending) {
          // The gap between the ack and the answer is where the client shows its
          // typing indicator, and it is the only place in the request where a model
          // round trip is allowed to be visible.
          send('working', {})
          await stream(await pending)
        }
        send('done', {})
      } catch (error) {
        send('error', { message: error instanceof Error ? error.message : 'stream failed' })
      } finally {
        // A follow-up still running when the stream is torn down would otherwise be
        // an unhandled rejection in the server log for a request nobody is reading.
        void pending?.catch(() => undefined)
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
