/**
 * A CateringRequest, as rows on a page (Phase D).
 *
 * Pure, so the rule below is a unit test rather than a screenshot review, and so
 * the same rows can be rendered to HTML today and to a PDF later without a second
 * implementation drifting away from this one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO FIGURE WITH A CURRENCY ON IT REACHES THE CUSTOMER'S DOCUMENT.
 *
 * Under the pivot the caterer is the first party to attach money to anything. The
 * budget she mentioned is the one monetary value that exists at this stage, and it
 * is *information for him* — repeating it back to her on a document she may
 * forward adds nothing, and it would make the price-leak test a judgement call
 * instead of a grep.
 *
 * `MONEY_FIELDS` is the list, and it is checked here rather than in the component,
 * because the component is where Phase B2's price block will want to live and a
 * rule that lives next to the markup is a rule that gets edited with it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { CateringRequest } from '../domain/catering-request'
import type { RequestAudience } from './links'

export type DocumentLanguage = 'de' | 'en'

export interface SummaryRow {
  /** Stable key, for tests and for the PDF renderer. */
  field: string
  label: string
  value: string
  /**
   * Below the confidence bar — worth him double-checking. Owner audience only: a
   * customer reading "we are not sure about this" about her own sentence learns
   * nothing and trusts the summary less.
   */
  uncertain?: boolean
}

/** Fields carrying money. Never rendered for the customer. See the header. */
export const MONEY_FIELDS = ['budgetIndication'] as const

/** Below this, the value is shown to the owner with a "worth checking" mark. */
const UNCERTAIN_BELOW = 0.8

export function requestRows(
  request: CateringRequest,
  audience: RequestAudience,
  language: DocumentLanguage = request.language === 'en' ? 'en' : 'de',
): SummaryRow[] {
  const de = language === 'de'
  const rows: SummaryRow[] = []

  const push = (
    field: string,
    label: string,
    value: string | undefined | null,
    confidence?: number,
  ) => {
    if (value === undefined || value === null || value === '') return
    if (audience === 'customer' && (MONEY_FIELDS as readonly string[]).includes(field)) return
    const uncertain =
      audience === 'owner' && confidence !== undefined && confidence < UNCERTAIN_BELOW
    rows.push({ field, label, value, ...(uncertain ? { uncertain } : {}) })
  }

  push(
    'occasion',
    de ? 'Anlass' : 'Occasion',
    request.occasion ? occasionLabel(request.occasion.value, de) : undefined,
    request.occasion?.confidence,
  )

  const dateValue = request.eventDate
    ? formatDate(request.eventDate.value, language) +
      (request.dateFlexible?.value ? (de ? ' (flexibel)' : ' (flexible)') : '')
    : undefined
  push('eventDate', de ? 'Datum' : 'Date', dateValue, request.eventDate?.confidence)

  push(
    'headcount',
    de ? 'Personen' : 'Guests',
    request.headcount ? String(request.headcount.value) : undefined,
    request.headcount?.confidence,
  )
  push('venue', de ? 'Ort' : 'Venue', request.venue?.value, request.venue?.confidence)
  push(
    'distanceKm',
    de ? 'Entfernung' : 'Distance',
    request.distanceKm ? `${request.distanceKm.value} km` : undefined,
    request.distanceKm?.confidence,
  )
  push(
    'serviceStyle',
    de ? 'Service' : 'Service',
    request.serviceStyle ? serviceStyleLabel(request.serviceStyle.value, de) : undefined,
    request.serviceStyle?.confidence,
  )
  push(
    'mealType',
    de ? 'Mahlzeit' : 'Meal',
    request.mealType ? mealTypeLabel(request.mealType.value, de) : undefined,
    request.mealType?.confidence,
  )
  push(
    'fulfilment',
    de ? 'Durchführung' : 'Fulfilment',
    request.fulfilment ? fulfilmentLabel(request.fulfilment.value, de) : undefined,
    request.fulfilment?.confidence,
  )
  push(
    'durationHours',
    de ? 'Dauer' : 'Duration',
    request.durationHours
      ? `${request.durationHours.value} ${de ? 'Stunden' : 'hours'}`
      : undefined,
    request.durationHours?.confidence,
  )
  push(
    'staffingNeeded',
    de ? 'Personal' : 'Staffing',
    request.staffingNeeded === undefined
      ? undefined
      : request.staffingNeeded.value
        ? de
          ? 'gewünscht'
          : 'requested'
        : de
          ? 'nicht nötig'
          : 'not needed',
    request.staffingNeeded?.confidence,
  )
  push('dietary', de ? 'Ernährung' : 'Dietary', joinList(request.dietary))
  push('equipmentNeeded', de ? 'Ausstattung' : 'Equipment', joinList(request.equipmentNeeded))
  push('requestedItems', de ? 'Gewünscht' : 'Requested', joinList(request.requestedItems))
  push(
    'specialRequirements',
    de ? 'Besonderes' : 'Special requirements',
    joinList(request.specialRequirements),
  )

  // Owner only, and last: it frames everything above it, and it is the one figure
  // on this page. See the header — never on her copy.
  if (request.budgetIndication) {
    const b = request.budgetIndication.value
    push(
      'budgetIndication',
      de ? 'Budget (ihre Angabe)' : 'Budget (as stated)',
      `${formatAmount(b.amount, language)} ${b.currency}` +
        (b.basis === 'per_head' ? (de ? ' pro Person' : ' per head') : ''),
      request.budgetIndication.confidence,
    )
  }

  return rows
}

function joinList(values: readonly string[] | undefined): string | undefined {
  if (!values || values.length === 0) return undefined
  return values.join(' · ')
}

/**
 * Dates are formatted, never passed through raw.
 *
 * "2027-06-12" on a document a caterer reads in a kitchen is a machine's date. An
 * unparseable value falls through unchanged rather than throwing, because a
 * malformed date is worth showing him — he can read what she wrote.
 */
function formatDate(iso: string, language: DocumentLanguage): string {
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(language === 'de' ? 'de-DE' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function formatAmount(amount: number, language: DocumentLanguage): string {
  return new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'en-GB').format(amount)
}

function occasionLabel(value: string, de: boolean): string {
  const labels: Record<string, [string, string]> = {
    wedding: ['Hochzeit', 'Wedding'],
    corporate: ['Firmenfeier', 'Corporate event'],
    birthday: ['Geburtstag', 'Birthday'],
    private_party: ['Private Feier', 'Private party'],
    conference: ['Konferenz', 'Conference'],
    funeral: ['Trauerfeier', 'Funeral'],
    other: ['Sonstiges', 'Other'],
  }
  return pick(labels[value], value, de)
}

function serviceStyleLabel(value: string, de: boolean): string {
  const labels: Record<string, [string, string]> = {
    buffet: ['Buffet', 'Buffet'],
    plated: ['Am Tisch serviert', 'Plated'],
    family: ['Familienstil', 'Family style'],
    fingerfood: ['Fingerfood', 'Finger food'],
    delivery: ['Anlieferung', 'Delivery'],
  }
  return pick(labels[value], value, de)
}

function mealTypeLabel(value: string, de: boolean): string {
  const labels: Record<string, [string, string]> = {
    breakfast: ['Frühstück', 'Breakfast'],
    brunch: ['Brunch', 'Brunch'],
    lunch: ['Mittagessen', 'Lunch'],
    dinner: ['Abendessen', 'Dinner'],
    snacks: ['Snacks', 'Snacks'],
    drinks: ['Getränke', 'Drinks'],
  }
  return pick(labels[value], value, de)
}

function fulfilmentLabel(value: string, de: boolean): string {
  const labels: Record<string, [string, string]> = {
    on_site: ['Vor Ort', 'On site'],
    delivery: ['Lieferung', 'Delivery'],
    pickup: ['Abholung', 'Pickup'],
  }
  return pick(labels[value], value, de)
}

/**
 * An unknown enum value is shown as itself rather than hidden.
 *
 * A value the model produced that we have no label for is a bug in one of two
 * places, and the caterer seeing `family_style` on his copy is how it gets found.
 * Dropping the row would lose the fact instead.
 */
function pick(entry: [string, string] | undefined, raw: string, de: boolean): string {
  if (!entry) return raw
  return de ? entry[0] : entry[1]
}
