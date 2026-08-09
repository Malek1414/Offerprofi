/**
 * Sending on WhatsApp (Phase E).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING SENDS WITHOUT `may_send_to_thread` SAYING SO.
 *
 * Both mandatory mitigations live behind that one call (migration 0013):
 *
 *   1. **Inbound-initiated only.** A thread with no `first_inbound_at` cannot be
 *      written to, and only the webhook sets that column. The questionnaire hands
 *      the customer a `wa.me` deep link with a prefilled first message; she opens
 *      the conversation, always.
 *   2. **A daily cap on new threads, and a kill switch**, both columns on
 *      `whatsapp_accounts` so they can be changed from a psql prompt at the moment
 *      they are needed rather than through a deploy.
 *
 * There is deliberately no `force` parameter, no "internal" variant that skips the
 * check, and no path that constructs a send without it. The provider is
 * unofficial (N3) and the number at risk is the agency's own — the number their
 * livelihood runs through.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A refused send is never a refused customer. Every caller falls back to email or
 * to the owner's tray; the enquiry is unaffected (I1).
 */

import { asAnonymous } from '../../db/client'
import { hasDatabase } from '../../lib/demo'

/** Why a send did not happen. Logged, and never shown to a customer. */
export type SendRefusal =
  | 'no_linked_account'
  | 'no_inbound_message'
  | 'daily_cap_reached'
  | 'sending_paused'
  | 'not_configured'
  | 'provider_error'

export type SendOutcome =
  | { ok: true; threadId: string; providerMessageId: string | null }
  | { ok: false; refusal: SendRefusal; detail?: string }

export interface SendRequest {
  agencyId: string
  /** E.164. Whose thread this is — the customer's, or the owner's own. */
  toPhone: string
  text: string
}

/**
 * Ask the database whether this send is permitted.
 *
 * Exported because the answer is worth having on its own: the owner's settings
 * screen should be able to say "you are 3 new conversations from today's cap"
 * without sending anything to find out.
 */
export async function maySend(
  agencyId: string,
  toPhone: string,
): Promise<{ allowed: boolean; reason: string; threadId: string | null }> {
  if (!hasDatabase()) return { allowed: false, reason: 'not_configured', threadId: null }

  return asAnonymous(async (client) => {
    const result = await client.query(
      `select allowed, reason, thread_id from public.may_send_to_thread($1::uuid, $2::text)`,
      [agencyId, toPhone],
    )
    const row = result.rows[0]
    if (!row) return { allowed: false, reason: 'no_linked_account', threadId: null }
    return {
      allowed: Boolean(row.allowed),
      reason: String(row.reason),
      threadId: row.thread_id ? String(row.thread_id) : null,
    }
  })
}

/**
 * Send one message.
 *
 * The gate first, the network call second, and the network call cannot be reached
 * any other way — the provider client is not exported.
 */
export async function sendWhatsApp(request: SendRequest): Promise<SendOutcome> {
  const gate = await maySend(request.agencyId, request.toPhone)

  if (!gate.allowed || !gate.threadId) {
    // Structured, because "why did we not message this customer" is a question
    // someone will ask, and "cap_reached" and "no_inbound_message" are very
    // different answers.
    console.warn(
      JSON.stringify({
        event: 'whatsapp_send_refused',
        agencyId: request.agencyId,
        reason: gate.reason,
      }),
    )
    return { ok: false, refusal: asRefusal(gate.reason) }
  }

  const sent = await postToProvider(request.agencyId, request.toPhone, request.text)
  if (!sent.ok) return sent

  await asAnonymous(async (client) => {
    await client.query(`select public.record_whatsapp_outbound($1::uuid)`, [gate.threadId])
  }).catch(() => undefined)

  return { ok: true, threadId: gate.threadId, providerMessageId: sent.providerMessageId }
}

/**
 * The provider call itself.
 *
 * Not exported. Everything provider-shaped stops here: a Cloud API migration
 * replaces this function and nothing above it. Absent credentials is a refusal,
 * not a throw — the caller falls back to email and the customer notices nothing.
 */
async function postToProvider(
  agencyId: string,
  toPhone: string,
  text: string,
): Promise<{ ok: true; providerMessageId: string | null } | { ok: false; refusal: SendRefusal; detail?: string }> {
  const apiKey = process.env.UNIPILE_API_KEY
  const baseUrl = process.env.UNIPILE_BASE_URL
  const accountId = process.env.UNIPILE_ACCOUNT_ID

  if (!apiKey || !baseUrl || !accountId) {
    return { ok: false, refusal: 'not_configured' }
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/chats/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      body: JSON.stringify({ account_id: accountId, to: toPhone, text }),
      // A hung provider must not hold a request open. The message is not urgent
      // enough to be worth a stuck connection.
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
      return { ok: false, refusal: 'provider_error', detail: `status ${response.status}` }
    }

    const body = (await response.json().catch(() => ({}))) as { id?: unknown }
    return { ok: true, providerMessageId: typeof body.id === 'string' ? body.id : null }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'whatsapp_provider_error',
        agencyId,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    return {
      ok: false,
      refusal: 'provider_error',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

function asRefusal(reason: string): SendRefusal {
  switch (reason) {
    case 'no_linked_account':
    case 'no_inbound_message':
    case 'daily_cap_reached':
    case 'not_configured':
      return reason
    default:
      // Anything else is the kill switch, whose reason string is operator-written
      // and must not be echoed anywhere a customer could see it.
      return 'sending_paused'
  }
}
