/**
 * Writing a chat turn down (F1.1, F1.5, F1.8).
 *
 * One call to `record_inbound_chat_turn`, which is SECURITY DEFINER because the
 * customer has no identity — see db/migrations/0007 for why that is the right shape
 * rather than a policy widening.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS MUST NEVER DELAY THE ACKNOWLEDGEMENT.
 *
 * F1.9 is "acknowledge, then work", and the target is under 10s p95 on a metric the
 * product is sold on. A database round trip in front of the first chunk would be a
 * regression in the number that wins deals, so the caller starts the stream first
 * and hands the resulting promise here.
 *
 * The consequence is that a failed write cannot be reported to the customer, and it
 * must not be: her message reached us, the acknowledgement is true, and an error
 * banner would tell her something is broken about *her* inquiry when what is broken
 * is our storage. It is logged loudly for us instead. Losing a transcript is bad;
 * telling a customer her enquiry failed when it did not is worse — and under
 * Invariant 1, a storage fault is emphatically not a reason to turn anyone away.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { asAnonymous } from '../db/client'
import { hasDatabase } from '../lib/demo'

export interface ChatTurnRecord {
  agencyId: string
  sessionTokenHash: string
  resumableUntil: string
  /** The envelope's idempotency key. The unique index on this is what makes replay a no-op. */
  externalMessageId: string
  bodyText: string
  /** Present only on the turn that actually showed it (I6). */
  disclosure?: {
    version: string
    language: string
    formality: string
    textShown: string
  }
}

export interface ChatTurnPersisted {
  inquiryId: string
  chatSessionId: string
  isNewInquiry: boolean
}

/**
 * Persist one inbound turn.
 *
 * Returns null when there is no database configured — the demo tenant path, where
 * the surface is walkable but nothing is stored.
 */
export async function recordChatTurn(turn: ChatTurnRecord): Promise<ChatTurnPersisted | null> {
  if (!hasDatabase()) return null

  return asAnonymous(async (client) => {
    const result = await client.query(
      `select inquiry_id, chat_session_id, is_new_inquiry
         from public.record_inbound_chat_turn($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        turn.agencyId,
        turn.sessionTokenHash,
        turn.resumableUntil,
        turn.externalMessageId,
        turn.bodyText,
        turn.disclosure?.version ?? null,
        turn.disclosure?.language ?? null,
        turn.disclosure?.formality ?? null,
        turn.disclosure?.textShown ?? null,
      ],
    )

    const row = result.rows[0]
    if (!row) return null
    return {
      inquiryId: String(row.inquiry_id),
      chatSessionId: String(row.chat_session_id),
      isNewInquiry: Boolean(row.is_new_inquiry),
    }
  })
}

/**
 * Fire the write and swallow the failure, loudly.
 *
 * Deliberately not exported as something awaited on the request path. The name says
 * what it does so that a future caller reaching for it has to notice.
 *
 * It resolves with the inquiry it wrote, and null when there was nothing to write
 * to or the write failed. That return is what the qualifying loop chains off:
 * extraction needs the inquiry id, and starting a second write to obtain it would
 * create a second inquiry for the same thread. One promise, two consumers.
 */
export function recordChatTurnDetached(turn: ChatTurnRecord): Promise<ChatTurnPersisted | null> {
  return recordChatTurn(turn).then(
    (persisted) => persisted,
    (error: unknown) => {
      // Structured enough to alert on. The turn is identified so the transcript can
      // be reconciled by hand if it ever matters.
      console.error(
        JSON.stringify({
          event: 'chat_turn_persist_failed',
          agencyId: turn.agencyId,
          externalMessageId: turn.externalMessageId,
          error: error instanceof Error ? error.message : String(error),
        }),
      )
      return null
    },
  )
}
