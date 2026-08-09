/**
 * What an inquiry state is called in front of a caterer (Phase F).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO LABEL HERE MAY READ AS A REFUSAL, AND ONE OF THEM ALMOST DID.
 *
 * `escalated` is an internal word for "the software stopped and a person is
 * needed". Shown to an owner as "eskaliert" it reads like a complaint, and shown
 * as "abgebrochen" it reads like the customer was dropped — which under
 * Invariant 1 is a thing that cannot happen and must not appear to have happened.
 * It is "wartet auf Sie": true, actionable, and about him rather than about a
 * failure.
 *
 * `spam` is the other one. It is a *tray*, not a verdict: the enquiry was
 * acknowledged like every other and is sitting here for him to look at. Calling
 * it "Spam" would invite him to believe the system turned someone away.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A test asserts none of these words appears in these labels.
 */

import type { CateringRequest } from '../domain/catering-request'
import type { InquiryState } from '../domain/inquiry-state'
import { requestRows } from '../requests/summary'

export type Urgency = 'waiting' | 'active' | 'done' | 'quiet'

export interface StateLabel {
  text: string
  urgency: Urgency
}

const LABELS: Record<InquiryState, StateLabel> = {
  new: { text: 'Neu', urgency: 'active' },
  acknowledged: { text: 'Bestätigt', urgency: 'active' },
  extracting: { text: 'Wird gelesen', urgency: 'active' },
  qualifying: { text: 'Im Gespräch', urgency: 'active' },
  sent_to_owner: { text: 'Wartet auf Sie', urgency: 'waiting' },
  priced: { text: 'Kalkuliert', urgency: 'active' },
  quote_sent: { text: 'Angebot raus', urgency: 'active' },
  negotiating: { text: 'In Abstimmung', urgency: 'active' },
  // Never "eskaliert". See the header.
  escalated: { text: 'Wartet auf Sie', urgency: 'waiting' },
  owner_handling: { text: 'Sie übernehmen', urgency: 'waiting' },
  accepted: { text: 'Angenommen', urgency: 'waiting' },
  confirmed: { text: 'Bestätigt — gebucht', urgency: 'done' },
  fulfilled: { text: 'Erledigt', urgency: 'done' },
  declined_by_customer: { text: 'Kundin hat abgesagt', urgency: 'quiet' },
  declined_by_owner: { text: 'Von Ihnen abgesagt', urgency: 'quiet' },
  expired: { text: 'Ohne Antwort verlaufen', urgency: 'quiet' },
  // A tray, not a verdict.
  spam: { text: 'Zur Durchsicht', urgency: 'quiet' },
  archived: { text: 'Archiviert', urgency: 'quiet' },
}

export function stateLabel(state: InquiryState): StateLabel {
  return LABELS[state] ?? { text: state, urgency: 'quiet' }
}

/**
 * What the list shows under a name. Typed values only — never her free text, so a
 * row in his inbox cannot be made to say something by a customer who types
 * carefully. Her own words are on the detail page, where he reads them as hers.
 */
const ONE_LINER_FIELDS: readonly { field: string; unit?: string }[] = [
  { field: 'eventDate' },
  // The unit is carried here because the detail page has a label column and this
  // line does not. "80" on its own is a number with no noun.
  { field: 'headcount', unit: 'Personen' },
  { field: 'serviceStyle' },
]

/** A one-line summary of the request, for the list. */
export function requestOneLiner(request: CateringRequest | null): string {
  if (!request) return 'Noch keine Details'

  // Through `requestRows` rather than reading the fields directly, so the list
  // and the detail page cannot disagree about what "buffet" is called. Reading
  // `serviceStyle.value` here printed the raw enum in his inbox.
  const rows = requestRows(request, 'owner', 'de')
  const parts = ONE_LINER_FIELDS.map(({ field, unit }) => {
    const value = rows.find((row) => row.field === field)?.value
    if (!value) return undefined
    return unit ? `${value} ${unit}` : value
  }).filter(Boolean)

  return parts.length ? parts.join(' · ') : 'Noch keine Details'
}

/** How long ago, in words a person uses. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  const minutes = Math.round((now.getTime() - then.getTime()) / 60000)
  if (minutes < 1) return 'gerade eben'
  if (minutes < 60) return `vor ${minutes} Min.`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `vor ${hours} Std.`
  const days = Math.round(hours / 24)
  if (days < 30) return `vor ${days} ${days === 1 ? 'Tag' : 'Tagen'}`
  return new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' }).format(then)
}
