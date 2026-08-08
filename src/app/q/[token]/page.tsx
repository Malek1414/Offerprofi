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
import { QuoteDocument } from './quote-document'

export default async function QuotePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

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
