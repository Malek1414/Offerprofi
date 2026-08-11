/**
 * Resolving a quote token to the document behind it.
 *
 * `asAnonymous`, because the customer holds a token and no identity — the same
 * shape as `resolveRequestLink` next door. Everything the stranger may see comes
 * back from one SECURITY DEFINER function that names its own columns, so widening
 * what a token exposes means editing SQL rather than forgetting a `select`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STORED FIGURES ARE READ BACK, NOT RECOMPUTED.
 *
 * `/r/{token}` deliberately re-prices on every view, because it is a *suggestion*
 * for the owner and his catalogue may have moved since. A quote is the opposite:
 * it is a document that was issued, on a date, at a number, and the customer was
 * told it stands until `valid_until`. Recomputing it would mean the price could
 * change under her between opening the link and reading it, which is exactly the
 * behaviour `freibleibend` exists to make unnecessary — and would make the stored
 * calculation trace a record of something nobody ever saw.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { asAnonymous } from '../db/client'
import type { CalculationTrace, PricedQuote, QuoteLine, TraceStep } from '../engine/pricing'
import { hasDatabase } from '../lib/demo'
import { hashQuoteToken } from './issue'

export interface ResolvedQuote {
  quoteVersionId: string
  agencyId: string
  quoteNumber: string
  versionNo: number
  lines: QuoteLine[]
  trace: CalculationTrace | null
  netTotalCents: number
  grossTotalCents: number
  vatBreakdown: { rate: number; net: number; vat: number }[]
  validUntil: string
  issuedAt: string
  legalTextVersion: string
  state: string
  agency: {
    name: string
    ownerName: string
    brandColor: string | null
    language: 'de' | 'en'
  }
}

export async function resolveQuoteLink(token: string): Promise<ResolvedQuote | null> {
  if (!hasDatabase()) return null

  return asAnonymous(async (client) => {
    const result = await client.query(
      `select quote_version_id, agency_id, quote_number, version_no, line_items,
              calculation_trace, net_total_cents, vat_breakdown, gross_total_cents,
              valid_until, legal_text_version, issued_at, quote_state,
              agency_name, agency_owner_name, agency_language, brand_color
         from public.resolve_quote_link($1::text)`,
      [hashQuoteToken(token)],
    )

    const row = result.rows[0]
    if (!row) return null

    return {
      quoteVersionId: String(row.quote_version_id),
      agencyId: String(row.agency_id),
      quoteNumber: String(row.quote_number),
      versionNo: Number(row.version_no),
      lines: (row.line_items as QuoteLine[]) ?? [],
      trace: (row.calculation_trace as CalculationTrace | null) ?? null,
      // bigint columns arrive as strings. These are cent amounts on a catering
      // quote, so the conversion is safe — but it is explicit, because a total
      // that silently stays a string renders as "118000" instead of "1.180,00 €".
      netTotalCents: Number(row.net_total_cents),
      grossTotalCents: Number(row.gross_total_cents),
      vatBreakdown: (row.vat_breakdown as ResolvedQuote['vatBreakdown']) ?? [],
      validUntil: new Date(row.valid_until).toISOString().slice(0, 10),
      issuedAt: new Date(row.issued_at).toISOString(),
      legalTextVersion: String(row.legal_text_version),
      state: String(row.quote_state),
      agency: {
        name: String(row.agency_name),
        ownerName: String(row.agency_owner_name ?? row.agency_name),
        brandColor: row.brand_color ? String(row.brand_color) : null,
        language: String(row.agency_language ?? 'de').toLowerCase().startsWith('en') ? 'en' : 'de',
      },
    }
  })
}

/**
 * Rebuild the `PricedQuote` the document renderer takes.
 *
 * The modifiers are read back out of the trace rather than stored a second time.
 * `TraceStep` 5 records every applied modifier by construction, so the trace is
 * already the complete record — storing them again would create two copies of one
 * fact, and the day they disagree the document and its own audit trail would be
 * telling a customer different things.
 */
export function rehydrateQuote(resolved: ResolvedQuote): PricedQuote {
  const steps = resolved.trace?.steps ?? []

  const modifiers = steps
    .filter((step): step is Extract<TraceStep, { step: 5 }> => step.step === 5)
    .map((step) => step.modifier)

  const unknownServiceIds = steps
    .filter((step): step is Extract<TraceStep, { step: 1 }> => step.step === 1)
    .flatMap((step) => step.unknown)

  return {
    lines: resolved.lines,
    modifiers,
    netTotal: resolved.netTotalCents as PricedQuote['netTotal'],
    vatBreakdown: resolved.vatBreakdown as PricedQuote['vatBreakdown'],
    grossTotal: resolved.grossTotalCents as PricedQuote['grossTotal'],
    trace: resolved.trace as PricedQuote['trace'],
    unknownServiceIds,
    // What was true when the quote was issued, not what is true now. A document
    // that silently changed its availability claim between two readings of the
    // same link would be a different document.
    availability: resolved.trace?.input.availability ?? 'available',
  }
}

/**
 * Count a view.
 *
 * "Quote view rate ≥ 80%" is a target metric and cannot be measured without this.
 * The identifiers are hashed before they leave this process — §7 calls the minimal
 * data footprint a feature rather than a tax, and a raw IP stored against a
 * customer surface would be the first thing to undo it.
 *
 * Failure is swallowed on purpose. A customer opening her quote must never see an
 * error because analytics had a bad day.
 */
export async function recordQuoteView(
  token: string,
  ipHash: string,
  userAgentHash: string,
): Promise<void> {
  if (!hasDatabase()) return
  try {
    await asAnonymous((client) =>
      client.query('select public.record_quote_view($1::text, $2::text, $3::text)', [
        hashQuoteToken(token),
        ipHash,
        userAgentHash,
      ]),
    )
  } catch {
    // Deliberately silent. See above.
  }
}
