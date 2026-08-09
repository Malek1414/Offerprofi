/**
 * Recording an inbound WhatsApp message (Phase E).
 *
 * Thin on purpose: the interesting part is in migration 0013, where writing
 * `first_inbound_at` is what grants permission to send at all.
 */

import { asAnonymous } from '../../db/client'
import { hasDatabase } from '../../lib/demo'

export interface InboundRecord {
  providerAccountId: string
  peerPhone: string
  peerRole?: 'customer' | 'owner'
  providerThreadId?: string | null
}

export interface InboundResult {
  agencyId: string
  threadId: string
  inquiryId: string | null
  isNewThread: boolean
}

/** Null when there is no database, or when the account is not one of ours. */
export async function recordWhatsAppInbound(input: InboundRecord): Promise<InboundResult | null> {
  if (!hasDatabase()) return null

  return asAnonymous(async (client) => {
    const result = await client.query(
      `select agency_id, thread_id, inquiry_id, is_new_thread
         from public.record_whatsapp_inbound($1::text, $2::text, $3::text, $4::text)`,
      [
        input.providerAccountId,
        input.peerPhone,
        input.peerRole ?? 'customer',
        input.providerThreadId ?? null,
      ],
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      agencyId: String(row.agency_id),
      threadId: String(row.thread_id),
      inquiryId: row.inquiry_id ? String(row.inquiry_id) : null,
      isNewThread: Boolean(row.is_new_thread),
    }
  })
}
