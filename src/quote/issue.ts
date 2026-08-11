/**
 * Turning an enquiry into a quote the customer can open.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORDER OF THE THREE STEPS IS THE WHOLE DESIGN.
 *
 *   price → check → persist
 *
 * Guardrails run on the **generated output**, after generation and before
 * anything is written, because that is the only position from which they can be
 * the control rather than a suggestion. CLAUDE.md §7: prompt instructions are a
 * first line, not the control. A guardrail consulted before pricing would be
 * checking an intention; one consulted after persisting would be checking a fact.
 *
 * A guardrail that trips does **not** decline the customer. It cannot: there is no
 * code path in this product that turns anybody away (invariant 1), and this
 * function has no branch that produces one. It returns `escalate`, which means the
 * owner sees why and decides — the same two outcomes the rest of the product has,
 * an offer or a human.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Nothing here is binding. The quote is *freibleibend*, the act with legal effect
 * is still the owner's confirmation after the customer accepts, and the button
 * that calls this is pressed by a person (invariants 3 and 4).
 */

import { createHash, randomBytes } from 'node:crypto'

import { withUser } from '../db/client'
import { LEGAL_TEXT_VERSION } from '../domain/legal'
import type { CateringRequest } from '../domain/catering-request'
import { loadGuardrails } from '../guardrails/repository'
import { evaluateOutbound, type GuardrailCheck, type GuardrailRule } from '../guardrails/evaluator'
import { suggestPrice } from '../requests/suggestion'
import type { PricedQuote } from '../engine/pricing'

/** How long a quote stands. Fourteen days is the default; the owner may say otherwise. */
const DEFAULT_VALIDITY_DAYS = 14

export interface IssuedQuote {
  token: string
  quoteId: string
  quoteVersionId: string
  quoteNumber: string
  versionNo: number
  grossTotalCents: number
  validUntil: string
  /** True when this call found a quote that had already been issued. */
  alreadyIssued: boolean
}

export type IssueOutcome =
  | { ok: true; quote: IssuedQuote }
  /**
   * Every reason issuing did not happen, as a code the UI localises. Never a raw
   * error string — a caterer reads this, and "no_catalogue" becomes a sentence
   * telling her what to do next rather than a stack trace.
   */
  | { ok: false; reason: 'no_request' | 'no_catalogue' | 'no_match' | 'unavailable' }
  /**
   * A guardrail stopped it. Distinct from `ok: false` because it is not a failure:
   * it is the product working, and the owner is being asked rather than told.
   */
  | { ok: false; reason: 'guardrail'; rule: GuardrailRule; ownerMessage: string; checks: GuardrailCheck[] }

/**
 * A quote token.
 *
 * 32 bytes of CSPRNG, base64url. The same shape and the same reasoning as
 * `mintRequestToken` in src/requests/links.ts: this is a bearer credential that
 * appears in a URL, so it has to be unguessable, and only its hash is stored so
 * that a database disclosure does not hand out working links.
 */
function mintQuoteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: createHash('sha256').update(token).digest('hex') }
}

export function hashQuoteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Tokens are 32 bytes base64url — 43 characters. Anything else is not one. */
export function isPlausibleQuoteToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token)
}

interface IssueQuoteRow {
  quote_id: string
  quote_version_id: string
  quote_number: string
  version_no: number
  already_issued: boolean
}

export interface IssueInput {
  userId: string
  agencyId: string
  inquiryId: string
  request: CateringRequest | null
  /** Negotiation state, for the guardrails that care about it. */
  negotiationRound?: number
  contactOptedOutAt?: string | null
}

export async function issueQuote(input: IssueInput): Promise<IssueOutcome> {
  if (!input.request) return { ok: false, reason: 'no_request' }

  // ─── 1. Price ─────────────────────────────────────────────────────────────
  // Deterministically, from this tenant's own catalogue. The model mapped intent
  // to catalogue items upstream; every figure below is arithmetic done in code
  // (D6), and the trace that reconstructs it is stored with the quote.
  const priced = await suggestPrice(input.agencyId, input.request, input.inquiryId)
  if (!priced.ok) return { ok: false, reason: priced.reason }

  const quote = priced.suggestion.quote

  // ─── 2. Check ─────────────────────────────────────────────────────────────
  const guardrails = await loadGuardrails(input.userId, input.agencyId)
  const verdict = evaluateOutbound({
    guardrails,
    // A person is pressing a button and looking at the result. The three rules
    // that exist to force exactly that are therefore already satisfied; every
    // content rule still applies. See `initiatedBy` in the evaluator.
    initiatedBy: 'owner',
    quote,
    negotiationRound: input.negotiationRound ?? 0,
    contactOptedOutAt: input.contactOptedOutAt ?? null,
    // Nothing has been committed about the date: calendar sync is not built, and
    // claiming availability we have not checked is exactly what this rule is for.
    availabilityCommitted: false,
    // The brief reached here through extraction, which already ran the injection
    // detector (A2). A second opinion here would be a second implementation.
    injectionSuspected: false,
    customerAssertedPrices: [],
  })

  if (verdict.action === 'escalate') {
    return {
      ok: false,
      reason: 'guardrail',
      rule: verdict.reason,
      ownerMessage: verdict.ownerMessage,
      checks: verdict.checks,
    }
  }

  // ─── 3. Persist ───────────────────────────────────────────────────────────
  const { token, hash } = mintQuoteToken()
  const validUntil = new Date(Date.now() + DEFAULT_VALIDITY_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10)

  const issued = await withUser(input.userId, async (client) => {
    const result = await client.query<IssueQuoteRow>(
      `select * from issue_quote($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        input.agencyId,
        input.inquiryId,
        hash,
        JSON.stringify(quote.lines),
        JSON.stringify(quote.trace),
        quote.netTotal,
        JSON.stringify(quote.vatBreakdown),
        quote.grossTotal,
        validUntil,
        LEGAL_TEXT_VERSION,
      ],
    )

    const row = result.rows[0]
    if (!row) throw new Error('issueQuote: issue_quote returned no row')

    // Every check that ran, passed or failed, on the record. §7: every quote
    // stores a full trace so any number can be reconstructed and defended — and
    // "the guardrails were evaluated and here is what they said" is part of that
    // defence, not separate from it.
    await recordChecks(client, input.agencyId, row.quote_version_id, verdict.checks)

    return row
  })

  return {
    ok: true,
    quote: {
      // ─────────────────────────────────────────────────────────────────────
      // The token is returned exactly once, here, and never read back.
      //
      // Only its hash is stored, so if this value is dropped the link is gone and
      // a new version has to be issued. That is the correct trade: the
      // alternative is a database that hands out working quote links.
      // ─────────────────────────────────────────────────────────────────────
      token,
      quoteId: issued.quote_id,
      quoteVersionId: issued.quote_version_id,
      quoteNumber: issued.quote_number,
      versionNo: issued.version_no,
      grossTotalCents: quote.grossTotal,
      validUntil,
      alreadyIssued: issued.already_issued,
    },
  }
}

async function recordChecks(
  client: { query: (_sql: string, _params: unknown[]) => Promise<unknown> },
  agencyId: string,
  quoteVersionId: string,
  checks: GuardrailCheck[],
): Promise<void> {
  for (const check of checks) {
    await client.query(
      `insert into guardrail_checks (agency_id, quote_version_id, rule, passed, details)
       values ($1, $2, $3, $4, $5)`,
      [agencyId, quoteVersionId, check.rule, check.passed, JSON.stringify(check.details ?? {})],
    )
  }
}

/**
 * Mint a replacement link for a quote that has already been issued.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SEPARATE, EXPLICIT ACTION AND NOT WHAT THE BUTTON DOES.
 *
 * Only the token's hash is stored, so a quote's link cannot be read back — press
 * the button twice and the second press has no link to return. The obvious fix is
 * to rotate the token on every press, and it is a trap: the customer may already
 * be holding the first link, and an accidental second press would silently 404
 * the document she was sent.
 *
 * So the main path never rotates, and recovery is this — named in the UI as
 * replacing the link, with the consequence stated. The same mechanism doubles as
 * revocation for a link that went to the wrong person, which is worth having.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function reissueQuoteLink(
  userId: string,
  agencyId: string,
  inquiryId: string,
): Promise<{ token: string; quoteNumber: string } | null> {
  const { token, hash } = mintQuoteToken()

  return withUser(userId, async (client) => {
    const result = await client.query<{ quote_number: string }>(
      `update quote_versions qv
       set token_hash = $3
       from quotes q
       where qv.quote_id = q.id
         and q.inquiry_id = $2
         and q.agency_id = $1
         and q.state <> 'draft'
         and qv.id = q.current_version_id
       returning q.quote_number`,
      [agencyId, inquiryId, hash],
    )

    const row = result.rows[0]
    if (!row) return null

    await client.query(
      `insert into quote_events (agency_id, quote_version_id, type, payload)
       select $1, q.current_version_id, 'link_replaced', '{}'::jsonb
       from quotes q where q.inquiry_id = $2 and q.agency_id = $1`,
      [agencyId, inquiryId],
    )

    return { token, quoteNumber: row.quote_number }
  })
}

/** What the customer's link looks like. One place, so the UI and the email agree. */
export function quotePath(token: string): string {
  return `/q/${token}`
}

export function pricedTotals(quote: PricedQuote): { net: number; gross: number } {
  return { net: quote.netTotal, gross: quote.grossTotal }
}
