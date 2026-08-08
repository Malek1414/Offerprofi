/**
 * AI disclosure in conversation (decision D25, EU AI Act Art. 50(1)).
 *
 * The customer is told at the *first* turn that they are talking to an AI. Not in a
 * footer, not on hover, not after they have shared their wedding date — the first
 * thing the assistant says.
 *
 * Art. 50(1) has been in application since 2 August 2026. It was explicitly carved
 * out of the Digital Omnibus deferral that pushed Annex III high-risk obligations to
 * December 2027, so it is enforceable by national market surveillance authorities
 * today, with exposure up to €15M or 3% of worldwide turnover.
 *
 * Every disclosure is versioned and stored with the conversation, so what a specific
 * customer saw on a specific date can be produced later. A screenshot of today's
 * copy proves nothing about last March.
 */

import type { Formality, Language } from './event-brief'

export const DISCLOSURE_VERSION = '2026-08-08.1'

export interface DisclosureParams {
  agencyName: string
  ownerName: string
  language: Language
  formality: Formality
  privacyNoticeUrl: string
}

export interface Disclosure {
  version: string
  /** Shown as the first assistant turn. */
  openingLine: string
  /** Persistent label in the chat header, visible for the whole conversation. */
  headerLabel: string
  /** Art. 13 GDPR — first contact is the correct moment for the privacy notice. */
  privacyLine: string
  requestHumanLabel: string
}

/**
 * Build the disclosure for a conversation.
 *
 * Formality is mirrored from the customer (D19). Getting Sie/Du wrong reads as
 * carelessness to a German speaker, and this is the first sentence they see.
 */
export function buildDisclosure(p: DisclosureParams): Disclosure {
  if (p.language === 'de') {
    const du = p.formality === 'du'
    return {
      version: DISCLOSURE_VERSION,
      openingLine: du
        ? `Hallo! Ich bin der KI-Assistent von ${p.agencyName} und helfe dir, schnell ein ` +
          `passendes Angebot zu bekommen. ${p.ownerName} prüft jedes Angebot vor der Bestätigung.`
        : `Hallo! Ich bin der KI-Assistent von ${p.agencyName} und helfe Ihnen, schnell ein ` +
          `passendes Angebot zu bekommen. ${p.ownerName} prüft jedes Angebot vor der Bestätigung.`,
      headerLabel: 'KI-Assistent',
      privacyLine: du
        ? `Wie wir mit deinen Daten umgehen, steht in der Datenschutzerklärung: ${p.privacyNoticeUrl}`
        : `Wie wir mit Ihren Daten umgehen, steht in der Datenschutzerklärung: ${p.privacyNoticeUrl}`,
      requestHumanLabel: `mit ${p.ownerName} sprechen`,
    }
  }

  return {
    version: DISCLOSURE_VERSION,
    openingLine:
      `Hi! I'm ${p.agencyName}'s AI assistant, here to get you a quote quickly. ` +
      `${p.ownerName} reviews every quote before it's confirmed.`,
    headerLabel: 'AI assistant',
    privacyLine: `How we handle your data: ${p.privacyNoticeUrl}`,
    requestHumanLabel: `Speak to ${p.ownerName}`,
  }
}

/** The stored record. Written before the first assistant turn is sent, never after. */
export interface DisclosureRecord {
  inquiryId: string
  version: string
  shownAt: string
  language: Language
  formality: Formality
  textShown: string
}

export function recordDisclosure(
  inquiryId: string,
  disclosure: Disclosure,
  language: Language,
  formality: Formality,
  now: string,
): DisclosureRecord {
  return {
    inquiryId,
    version: disclosure.version,
    shownAt: now,
    language,
    formality,
    textShown: disclosure.openingLine,
  }
}
