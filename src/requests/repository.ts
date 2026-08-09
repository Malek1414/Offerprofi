/**
 * Sending a request, and reading one back by its token (Phase D).
 *
 * Both go through db/migrations/0011, SECURITY DEFINER for the reason every read
 * on this side of the product is: the people using these two links have no
 * identity. She has a token; he has a different token; neither has an account.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CUSTOMER'S DOCUMENT IS BUILT FROM A ROW THAT HAS NOTHING TO HIDE.
 *
 * `resolve_request_link` returns contact details only for the owner's audience,
 * so `ResolvedRequest.contact` is null on hers by construction rather than by a
 * filter in a component. When the price suggestion arrives it goes in the same
 * place. The rule — nothing that is his to know appears in her copy — is then a
 * property of the query, and the price-leak test is checking a guarantee rather
 * than a habit.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { asAnonymous } from '../db/client'
import type { CateringRequest } from '../domain/catering-request'
import type { ContactPartition } from '../domain/extracted'
import type { InquiryState } from '../domain/inquiry-state'
import { hasDatabase } from '../lib/demo'
import { type RequestAudience, hashRequestToken } from './links'

export interface SendResult {
  state: InquiryState
  /** True when she had already sent. The second press is not a second request. */
  alreadySent: boolean
}

/** The agency, as a stranger holding a token may see it. */
export interface RequestAgency {
  name: string
  ownerName: string
  brandColor: string | null
  privacyNoticeUrl: string
  imprintUrl: string
  language: 'de' | 'en'
}

export interface ResolvedRequest {
  audience: RequestAudience
  agencyId: string
  inquiryId: string
  state: InquiryState
  sentAt: string
  request: CateringRequest | null
  /** Owner audience only. Null on the customer's document, from the query down. */
  contact: ContactPartition | null
  agency: RequestAgency
}

/**
 * Which inquiry the browser pressing send is in.
 *
 * The session cookie is the whole of the identity here, which is correct — she has
 * no account (D11) — and it is why this reads nothing the token does not already
 * imply.
 */
export async function inquiryForSession(
  agencyId: string,
  sessionTokenHash: string,
): Promise<{ inquiryId: string; state: InquiryState } | null> {
  if (!hasDatabase()) return null

  return asAnonymous(async (client) => {
    const result = await client.query(
      `select inquiry_id, state from public.inquiry_for_session($1::uuid, $2::text)`,
      [agencyId, sessionTokenHash],
    )
    const row = result.rows[0]
    if (!row) return null
    return { inquiryId: String(row.inquiry_id), state: row.state as InquiryState }
  })
}

export async function sendRequestToOwner(input: {
  agencyId: string
  inquiryId: string
  customerTokenHash: string
  ownerTokenHash: string
}): Promise<SendResult | null> {
  if (!hasDatabase()) return null

  return asAnonymous(async (client) => {
    const result = await client.query(
      `select state, already_sent
         from public.send_request_to_owner($1::uuid, $2::uuid, $3::text, $4::text)`,
      [input.agencyId, input.inquiryId, input.customerTokenHash, input.ownerTokenHash],
    )
    const row = result.rows[0]
    if (!row) return null
    return { state: row.state as InquiryState, alreadySent: Boolean(row.already_sent) }
  })
}

/**
 * Resolve a raw token to its document.
 *
 * Null for a token that does not exist, a revoked one, and a malformed one alike.
 * The caller renders the same neutral not-found for all three — a page that
 * distinguished them would tell whoever is guessing which guesses are close.
 */
export async function resolveRequestLink(token: string): Promise<ResolvedRequest | null> {
  if (!hasDatabase()) return null

  return asAnonymous(async (client) => {
    const result = await client.query(
      `select audience, agency_id, inquiry_id, state, sent_at, brief_json, contact_json,
              agency_name, owner_display_name, color_primary, privacy_notice_url,
              imprint_url, locale
         from public.resolve_request_link($1::text)`,
      [hashRequestToken(token)],
    )

    const row = result.rows[0]
    if (!row) return null

    return {
      audience: row.audience as RequestAudience,
      agencyId: String(row.agency_id),
      inquiryId: String(row.inquiry_id),
      state: row.state as InquiryState,
      sentAt: new Date(row.sent_at).toISOString(),
      request: (row.brief_json as CateringRequest | null) ?? null,
      contact: (row.contact_json as ContactPartition | null) ?? null,
      agency: {
        name: String(row.agency_name),
        // The greeting says "Johannes". Falling back to the trading name beats an
        // empty one for an agency that never filled this in.
        ownerName: String(row.owner_display_name ?? row.agency_name),
        brandColor: row.color_primary ? String(row.color_primary) : null,
        privacyNoticeUrl: row.privacy_notice_url ? String(row.privacy_notice_url) : '/datenschutz',
        imprintUrl: row.imprint_url ? String(row.imprint_url) : '/impressum',
        language: String(row.locale ?? 'de')
          .toLowerCase()
          .startsWith('en')
          ? 'en'
          : 'de',
      },
    }
  })
}
