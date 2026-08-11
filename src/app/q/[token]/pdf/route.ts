/**
 * `GET /q/{token}/pdf` — the quote as a file (A5).
 *
 * The web quote at `/q/{token}` and this route render the same numbers from the
 * same `priceQuote` call. Neither computes anything: if these two ever disagree,
 * one of them is doing arithmetic it should not be (D6).
 *
 * The token is the whole of the authorisation, exactly as on the page — the
 * customer has no account and never will (D11). A bad token is a neutral 404,
 * not a message distinguishing "expired" from "never existed", because a page
 * that told them apart would tell whoever is guessing which guesses are close.
 */

import { priceQuote } from '../../../../engine/pricing'
import {
  DEMO_AGENCY,
  DEMO_BRAND_COLOR,
  DEMO_QUOTE_META,
  demoCatalogue,
  demoPricingInput,
  hasDatabase,
} from '../../../../lib/demo'
import { renderQuotePdf } from '../../../../quote/pdf'

export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params

  // Mirrors the page: until a quote is looked up for real, one well-known token
  // renders the demo tenant so the surface can be reviewed.
  if (hasDatabase() || token !== 'demo') {
    if (token !== 'demo') return new Response('Not found', { status: 404 })
  }

  const pdf = await renderQuotePdf({
    agencyName: DEMO_AGENCY.name,
    ownerName: DEMO_AGENCY.ownerName,
    brandColor: DEMO_BRAND_COLOR,
    quoteNumber: DEMO_QUOTE_META.quoteNumber,
    issuedOn: DEMO_QUOTE_META.issuedOn,
    validUntil: DEMO_QUOTE_META.validUntil,
    customerName: DEMO_QUOTE_META.customerName,
    eventSummary: DEMO_QUOTE_META.eventSummary,
    language: 'de',
    quote: priceQuote(demoPricingInput(), demoCatalogue()),
  })

  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      // `inline` so it opens in the browser tab she is already in. The filename
      // still applies the moment she saves it.
      'Content-Disposition': `inline; filename="Angebot-${DEMO_QUOTE_META.quoteNumber}.pdf"`,
      // A quote is priced per request and must never be served from a shared cache.
      'Cache-Control': 'private, no-store',
    },
  })
}
