/**
 * `GET /r/{token}` — the request summary (Phase D).
 *
 * One route, two documents. The token decides which, and it decides it in the
 * database: `resolve_request_link` returns contact details for the owner's
 * audience and nulls for hers, so the two copies differ by the row they are built
 * from rather than by a condition in a component.
 *
 * A token that does not exist, one that was revoked, and one that is malformed all
 * render the same neutral not-found. Distinguishing them would tell whoever is
 * guessing which guesses are close, and the thing behind the guess is a stranger's
 * enquiry.
 */

import { notFound } from 'next/navigation'

import { syntheticContentMarking } from '../../../domain/legal'
import { buildAgencyTheme } from '../../../lib/theme'
import { isPlausibleRequestToken } from '../../../requests/links'
import { resolveRequestLink } from '../../../requests/repository'
import { requestRows } from '../../../requests/summary'
import { RequestDocument } from './request-document'

// The token is a credential in a URL. It must never be cached by a shared proxy,
// and a stale render of an enquiry is worse than a slow one.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  // Not on any customer surface, but this one carries a name and an event.
  robots: { index: false, follow: false },
}

export default async function RequestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  if (!isPlausibleRequestToken(token)) notFound()

  const resolved = await resolveRequestLink(token)
  if (!resolved) notFound()

  // A request with nothing extracted still has a document. The link is valid, she
  // did send it, and the caterer has the conversation — rendering the empty state
  // is honest, where a 404 would tell her the enquiry she just sent does not exist.
  const language =
    resolved.request?.language === 'en' ? 'en' : resolved.agency.language
  const rows = resolved.request
    ? requestRows(resolved.request, resolved.audience, language)
    : []
  const theme = buildAgencyTheme(resolved.agency.brandColor)

  return (
    <>
      {/* AI Act Art. 50(2) — machine-readable marking of synthetic content. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(syntheticContentMarking(resolved.sentAt)),
        }}
      />
      <RequestDocument
        audience={resolved.audience}
        agency={resolved.agency}
        theme={theme}
        rows={rows}
        contact={resolved.contact}
        sentAt={resolved.sentAt}
        language={language}
      />
    </>
  )
}
