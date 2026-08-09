/**
 * Reading back what a conversation already knows, and moving it forward.
 *
 * The counterpart to brief-store.ts: that writes a CateringRequest, this reads one
 * back together with the tail of the transcript, and records the state move the
 * turn produced. Both go through db/migrations/0010, which is SECURITY DEFINER for
 * the same reason 0007 and 0009 are — the customer in the chat has no identity.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS WHAT MAKES THE CONTEXT BOUNDED.
 *
 * A turn is given the stored request, which is the accumulated result of every
 * previous turn, plus the last few messages. Not the chat log. A conversation
 * eighty messages long therefore sends no more to the model than one four messages
 * long, and nothing load-bearing lives only in scrolled-off history.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The two halves stay two halves here as well: `request` and `contact` arrive in
 * separate columns and are returned as separate fields. Nothing in this file ever
 * holds an object containing both (I2).
 */

import { asAnonymous } from '../db/client'
import type { CateringRequest } from '../domain/catering-request'
import type { ContactPartition } from '../domain/extracted'
import type { InquiryState } from '../domain/inquiry-state'
import { hasDatabase } from '../lib/demo'
import { TRANSCRIPT_WINDOW } from './qualify'

export interface ConversationMessage {
  id: string
  text: string
}

export interface ConversationContext {
  /** Null until the first extraction has run on this inquiry. */
  request: CateringRequest | null
  contact: ContactPartition | null
  /** Inbound only, oldest first, at most TRANSCRIPT_WINDOW of them. */
  messages: ConversationMessage[]
  state: InquiryState
  /** True once a human is on the thread. No agent turn may be generated (I5). */
  automationPaused: boolean
}

/**
 * The context for one qualifying turn.
 *
 * Returns null when there is no database — the demo tenant path, where the surface
 * is walkable and nothing is stored. The caller falls back to the turn in hand.
 */
export async function loadConversationContext(
  agencyId: string,
  inquiryId: string,
): Promise<ConversationContext | null> {
  if (!hasDatabase()) return null

  return asAnonymous(async (client) => {
    const result = await client.query(
      `select brief_json, contact_json, messages, state, automation_paused
         from public.conversation_context($1::uuid, $2::uuid, $3::int)`,
      [agencyId, inquiryId, TRANSCRIPT_WINDOW],
    )

    const row = result.rows[0]
    if (!row) return null

    return {
      request: asRequest(row.brief_json),
      contact: (row.contact_json as ContactPartition | null) ?? null,
      messages: asMessages(row.messages),
      state: row.state as InquiryState,
      automationPaused: Boolean(row.automation_paused),
    }
  })
}

/**
 * What the turn produced. Two values, and there is no third.
 *
 * `escalated` is not a decline and never becomes one — it hands the thread to a
 * person with the whole record in front of them (I1, I5).
 */
export type AgentProgress = 'qualifying' | 'escalated'

/**
 * Record the state move.
 *
 * Failure is logged and swallowed. The customer has already been answered by the
 * time this runs, and an inquiry stuck in `new` is a reporting problem; telling her
 * something went wrong with her enquiry, when what went wrong is our bookkeeping,
 * is a worse one.
 */
export async function recordAgentProgress(
  agencyId: string,
  inquiryId: string,
  outcome: AgentProgress,
  reason?: string,
): Promise<InquiryState | null> {
  if (!hasDatabase()) return null

  try {
    return await asAnonymous(async (client) => {
      const result = await client.query(
        `select public.record_agent_progress($1::uuid, $2::uuid, $3::text, $4::text) as state`,
        [agencyId, inquiryId, outcome, reason ?? null],
      )
      const row = result.rows[0]
      return row ? (row.state as InquiryState) : null
    })
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'agent_progress_failed',
        agencyId,
        inquiryId,
        outcome,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    return null
  }
}

/**
 * A stored brief is one we wrote, but it is still parsed defensively.
 *
 * A row written by an older `EXTRACTION_VERSION` is the realistic case, and one
 * missing `meta` would throw inside `evaluateRequest` at the point where the
 * customer is waiting. Treating it as absent means the turn re-extracts from the
 * transcript instead, which is slower and correct.
 */
function asRequest(value: unknown): CateringRequest | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<CateringRequest>
  if (!candidate.meta || typeof candidate.meta !== 'object') return null
  if (typeof candidate.meta.overallConfidence !== 'number') return null
  return candidate as CateringRequest
}

function asMessages(value: unknown): ConversationMessage[] {
  if (!Array.isArray(value)) return []
  const messages: ConversationMessage[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const { id, text } = entry as { id?: unknown; text?: unknown }
    if (typeof id !== 'string' || typeof text !== 'string') continue
    messages.push({ id, text })
  }
  return messages
}
