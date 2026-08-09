/**
 * What the caterer gets on his phone when a request comes in (Phase E).
 *
 * Pure composition, so the wording is unit-tested rather than read off a screen
 * once. The sending is `send.ts`, which is where the mitigations live.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MESSAGE IS THE PRODUCT'S FIRST IMPRESSION ON THE PERSON PAYING FOR IT.
 *
 * He is standing in a kitchen. What he needs in the first two lines is whether
 * this is worth stopping for: who, when, how many, where. The link comes after,
 * because a link first reads as a notification about software rather than about
 * an enquiry.
 *
 * No price appears here, even though his page has one. WhatsApp previews render
 * on a lock screen, and a number on a lock screen is a number without its
 * context — "€6,240" glanced at in a hallway becomes a figure he half-remembers
 * having agreed to.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { ContactPartition } from '../../domain/extracted'
import type { DocumentLanguage, SummaryRow } from '../../requests/summary'

export interface OwnerNotification {
  /** What goes over WhatsApp. Plain text: no markdown, no HTML. */
  text: string
}

const HEADLINE_FIELDS = ['eventDate', 'headcount', 'venue', 'serviceStyle'] as const

/**
 * Build the owner's message.
 *
 * `rows` is the same owner-audience summary the document renders, so the message
 * and the page cannot disagree about what she asked for.
 */
export function ownerNotification(input: {
  contact: ContactPartition | null
  rows: readonly SummaryRow[]
  url: string
  language?: DocumentLanguage
}): OwnerNotification {
  const de = (input.language ?? 'de') === 'de'
  const who = input.contact?.name?.trim() || (de ? 'Neue Anfrage' : 'New enquiry')

  const headline = HEADLINE_FIELDS.map(
    (field) => input.rows.find((r) => r.field === field)?.value,
  ).filter(Boolean)

  const lines = [
    de ? `Neue Catering-Anfrage von ${who}` : `New catering enquiry from ${who}`,
    headline.length ? headline.join(' · ') : de ? 'Details im Link' : 'Details in the link',
    '',
    de ? `Alles ansehen: ${input.url}` : `See everything: ${input.url}`,
    '',
    // He replies here, in his own words. Saying so is what turns a notification
    // into the way the product is actually used.
    de
      ? 'Antworten Sie einfach hier — Preise, Termine, Bedingungen. Daraus mache ich ein Angebot.'
      : "Just reply here — prices, dates, conditions. I'll turn it into an offer.",
  ]

  return { text: lines.join('\n') }
}

/**
 * The `wa.me` deep link the customer taps to open the thread herself.
 *
 * MITIGATION 1, on the customer's side. We never open a conversation with a
 * number that has not written to us, so the only way a thread exists is that she
 * started it — and the only way she starts it conveniently is a link with the
 * first message already typed.
 *
 * The phone number is digits only: `wa.me` rejects `+`, spaces and dashes, and
 * fails by opening a "number not on WhatsApp" page rather than by erroring, which
 * would be a dead end nobody notices.
 */
export function waMeLink(agencyPhoneE164: string, prefilledMessage: string): string {
  const digits = agencyPhoneE164.replace(/\D/g, '')
  return `https://wa.me/${digits}?text=${encodeURIComponent(prefilledMessage)}`
}

/**
 * The first message we put in her mouth.
 *
 * Deliberately hers rather than ours, and deliberately short: she will edit it,
 * and a paragraph of our copy in her outbox reads as a form she is being made to
 * fill in. The reference is what lets the webhook attach her thread to the
 * enquiry she already started on the web.
 */
export function prefilledFirstMessage(
  agencyName: string,
  reference: string | null,
  language: DocumentLanguage = 'de',
): string {
  const de = language === 'de'
  const opener = de
    ? `Hallo ${agencyName}, ich hätte gern ein Catering-Angebot.`
    : `Hello ${agencyName}, I'd like a catering quote.`
  return reference ? `${opener} (${reference})` : opener
}
