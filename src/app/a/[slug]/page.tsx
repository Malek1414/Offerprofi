/**
 * The hosted chat surface, screen S4 (F1.4).
 *
 * Server component. The slug is resolved to a tenant here and the agency's identity
 * is handed to the client as props — the browser never names a tenant, so there is
 * nothing to tamper with (F1.4).
 *
 * This is the launch channel and the first thing a stranger sees of the agency, so
 * it renders in the agency's brand (§15) rather than ours. Mobile-first: it is
 * reached from an Instagram bio link on a phone, in a queue, one-handed.
 */

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { buildAgencyTheme, themeStyle } from '../../../lib/theme'
import { resolveAgencyBySlug } from '../../../lib/agency'
import { buildDisclosure } from '../../../domain/disclosure'
import { chatStrings } from '../../../chat/conversation'
import { ChatClient } from './chat-client'

export const metadata: Metadata = {
  title: 'Anfrage',
  // The chat carries what a customer is planning and, once she types it, who she
  // is. Nothing here belongs in an index.
  robots: { index: false, follow: false },
}

export default async function ChatPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const agency = await resolveAgencyBySlug(slug)
  // A neutral not-found. It must not distinguish "no such agency" from any other
  // reason, or the endpoint becomes a way to enumerate tenants.
  if (!agency) notFound()

  const theme = buildAgencyTheme(agency.brandColor)

  // The opening voice is the agency's default until the customer's first message
  // tells us otherwise (F1.15) — the disclosure is shown before anyone has typed.
  const language = agency.defaultLanguage
  const formality = agency.forceFormality ?? agency.defaultFormality

  const disclosure = buildDisclosure({
    agencyName: agency.name,
    ownerName: agency.ownerName,
    language,
    formality,
    privacyNoticeUrl: agency.privacyNoticeUrl,
  })

  return (
    <main style={themeStyle(theme)}>
      <ChatClient
        slug={agency.slug}
        agencyName={agency.name}
        ownerName={agency.ownerName}
        logoUrl={agency.logoUrl}
        privacyNoticeUrl={agency.privacyNoticeUrl}
        imprintUrl={agency.imprintUrl}
        disclosure={disclosure}
        strings={chatStrings(language, formality)}
        language={language}
        formality={formality}
      />
    </main>
  )
}
