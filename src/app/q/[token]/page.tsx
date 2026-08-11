/**
 * Tokenised quote view (FEATURE_INVENTORY F5.2, F5.7).
 *
 * Server component. The token is resolved server-side to a quote version; the
 * client never supplies an agency id, and a bad token renders a neutral not-found
 * rather than confirming that some other token would have worked.
 */

import { notFound } from 'next/navigation'

import { priceQuote } from '../../../engine/pricing'
import { quoteLegalBlock, syntheticContentMarking } from '../../../domain/legal'
import { buildAgencyTheme } from '../../../lib/theme'
import {
  DEMO_AGENCY,
  DEMO_BRAND_COLOR,
  DEMO_QUOTE_META,
  demoCatalogue,
  demoPricingInput,
  hasDatabase,
} from '../../../lib/demo'
import { isPlausibleQuoteToken } from '../../../quote/issue'
import { rehydrateQuote, resolveQuoteLink } from '../../../quote/repository'
import { QuoteDocument } from './quote-document'

export default async function QuotePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  // ─── The real path ────────────────────────────────────────────────────────
  //
  // A quote issued by the owner's button resolves here. The figures are read back
  // exactly as they were written — not recomputed — because this document was
  // issued on a date at a number and the customer was told it stands until
  // `validUntil`. See the note in src/quote/repository.ts.
  if (isPlausibleQuoteToken(token)) {
    const resolved = await resolveQuoteLink(token)
    if (!resolved) notFound()

    const theme = buildAgencyTheme(resolved.agency.brandColor)
    const legal = quoteLegalBlock(
      {
        agencyName: resolved.agency.name,
        validUntil: resolved.validUntil,
        language: resolved.agency.language,
      },
      resolved.agency.ownerName,
    )

    return (
      <>
        {/* AI Act Art. 50(2) — machine-readable marking of synthetic content (I6). */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(syntheticContentMarking(resolved.issuedAt)),
          }}
        />
        <QuoteDocument
          agency={{
            name: resolved.agency.name,
            legalName: resolved.agency.name,
            address: [],
            contact: '',
            taxId: '',
            logoUrl: null,
            ownerName: resolved.agency.ownerName,
          }}
          theme={theme}
          quote={rehydrateQuote(resolved)}
          quoteNumber={resolved.quoteNumber}
          issuedOn={resolved.issuedAt.slice(0, 10)}
          validUntil={resolved.validUntil}
          customerName=""
          eventSummary=""
          legal={legal}
          language={resolved.agency.language}
          state="sent"
        />
      </>
    )
  }

  // Until Postgres is provisioned, one well-known token renders the demo tenant so
  // the surface can be reviewed. With a database configured this branch is dead and
  // the token is looked up for real.
  if (hasDatabase() || token !== 'demo') {
    if (token !== 'demo') notFound()
  }

  const quote = priceQuote(demoPricingInput(), demoCatalogue())
  const theme = buildAgencyTheme(DEMO_BRAND_COLOR)
  const legal = quoteLegalBlock(
    {
      agencyName: DEMO_AGENCY.name,
      validUntil: DEMO_QUOTE_META.validUntil,
      language: 'de',
    },
    DEMO_AGENCY.ownerName,
  )

  const marking = syntheticContentMarking(new Date().toISOString())

  return (
    <>
      {/* AI Act Art. 50(2) — machine-readable marking of synthetic content (I6). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(marking) }}
      />
      <QuoteDocument
        agency={DEMO_AGENCY}
        theme={theme}
        quote={quote}
        quoteNumber={DEMO_QUOTE_META.quoteNumber}
        issuedOn={DEMO_QUOTE_META.issuedOn}
        validUntil={DEMO_QUOTE_META.validUntil}
        customerName={DEMO_QUOTE_META.customerName}
        eventSummary={DEMO_QUOTE_META.eventSummary}
        legal={legal}
        language="de"
        state="sent"
      />
    </>
  )
}
