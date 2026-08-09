/**
 * The owner's inbox (Phase F).
 *
 * Read-only, and through `withUser` like every other owner-side query — RLS
 * resolves the tenant from `app.current_user_id`, so no statement here filters by
 * `agency_id` for security purposes and a forgotten filter is not a leak.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE PLACE THE TWO HALVES ARE SHOWN SIDE BY SIDE.
 *
 * Everywhere else in the product, `brief_json` and `contact_json` are kept apart
 * because pricing must never see a person (I2). Here they are read together and
 * that is correct: this is a human reading his own enquiries, which is the entire
 * point of the partition — the *engine* cannot reach the contact, the *owner*
 * always can.
 *
 * They still arrive as two fields and are never merged into one object, so the
 * habit survives the one place it is relaxed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { withUser } from '../db/client'
import type { CateringRequest } from '../domain/catering-request'
import type { ContactPartition } from '../domain/extracted'
import type { InquiryState } from '../domain/inquiry-state'

export interface InboxRow {
  inquiryId: string
  state: InquiryState
  channel: string
  firstMessageAt: string
  /** Null until an extraction has run. */
  request: CateringRequest | null
  contact: ContactPartition | null
  /** The owner's document, when she has sent. Null before that. */
  ownerToken: string | null
  automationPaused: boolean
  escalationReason: string | null
  messageCount: number
}

/**
 * Everything worth looking at, newest first.
 *
 * `archived` is excluded and nothing else is: an owner's inbox that hides
 * escalated or spam-flagged enquiries hides exactly the ones needing a person,
 * and under Invariant 1 a triaged enquiry is still a customer waiting.
 *
 * No pagination yet. A caterer sees 20–60 requests a month, so the first version
 * that needs a page break is a long way off and a limit is an honest placeholder.
 */
export async function listInbox(userId: string, limit = 100): Promise<InboxRow[]> {
  return withUser(userId, async (client) => {
    const result = await client.query(
      `select i.id,
              i.state,
              i.channel,
              i.first_message_at,
              i.automation_paused,
              i.escalation_reason,
              eb.brief_json,
              eb.contact_json,
              (select count(*) from messages m where m.inquiry_id = i.id) as message_count,
              -- The owner's own link, so the inbox can hand him the page with the
              -- price suggestion on it rather than making him find the WhatsApp.
              (select l.token_hash from request_links l
                where l.inquiry_id = i.id and l.audience = 'owner'
                  and l.revoked_at is null
                limit 1) as owner_token_hash
         from inquiries i
         left join event_briefs eb on eb.inquiry_id = i.id
        where i.state <> 'archived'
        order by i.first_message_at desc
        limit $1`,
      [limit],
    )

    return result.rows.map((row) => ({
      inquiryId: String(row.id),
      state: row.state as InquiryState,
      channel: String(row.channel),
      firstMessageAt: new Date(row.first_message_at).toISOString(),
      request: (row.brief_json as CateringRequest | null) ?? null,
      contact: (row.contact_json as ContactPartition | null) ?? null,
      // The hash, not the token: we cannot reconstruct the URL, and storing the
      // raw token so the inbox could link to it would defeat hashing them at all.
      // Presence is what the inbox needs — "sent" versus "not sent yet".
      ownerToken: row.owner_token_hash ? String(row.owner_token_hash) : null,
      automationPaused: Boolean(row.automation_paused),
      escalationReason: row.escalation_reason ? String(row.escalation_reason) : null,
      messageCount: Number(row.message_count ?? 0),
    }))
  })
}

export interface InboxDetail extends InboxRow {
  /** Oldest first. Both halves of the conversation, as far as they are stored. */
  messages: { id: string; direction: string; sender: string; text: string; at: string }[]
}

export async function loadInquiry(userId: string, inquiryId: string): Promise<InboxDetail | null> {
  return withUser(userId, async (client) => {
    const result = await client.query(
      `select i.id, i.state, i.channel, i.first_message_at, i.automation_paused,
              i.escalation_reason, eb.brief_json, eb.contact_json,
              (select l.token_hash from request_links l
                where l.inquiry_id = i.id and l.audience = 'owner' and l.revoked_at is null
                limit 1) as owner_token_hash
         from inquiries i
         left join event_briefs eb on eb.inquiry_id = i.id
        where i.id = $1`,
      [inquiryId],
    )

    const row = result.rows[0]
    // Null covers "no such inquiry" and "not yours" alike, because RLS filtered
    // the second into the first before this code ran.
    if (!row) return null

    const messages = await client.query(
      `select id, direction, sent_by, body_text, created_at
         from messages
        where inquiry_id = $1
        order by created_at`,
      [inquiryId],
    )

    return {
      inquiryId: String(row.id),
      state: row.state as InquiryState,
      channel: String(row.channel),
      firstMessageAt: new Date(row.first_message_at).toISOString(),
      request: (row.brief_json as CateringRequest | null) ?? null,
      contact: (row.contact_json as ContactPartition | null) ?? null,
      ownerToken: row.owner_token_hash ? String(row.owner_token_hash) : null,
      automationPaused: Boolean(row.automation_paused),
      escalationReason: row.escalation_reason ? String(row.escalation_reason) : null,
      messageCount: messages.rowCount ?? 0,
      messages: messages.rows.map((m) => ({
        id: String(m.id),
        direction: String(m.direction),
        sender: String(m.sent_by),
        text: String(m.body_text ?? ''),
        at: new Date(m.created_at).toISOString(),
      })),
    }
  })
}
