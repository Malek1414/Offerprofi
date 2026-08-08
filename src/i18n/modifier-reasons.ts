/**
 * Localised surcharge explanations (X5).
 *
 * The pricing engine emits a reason code and parameters; this turns them into a
 * sentence in the customer's own language. Keeping the split means a new language is
 * a new entry here rather than a change to the engine, and the engine stays free of
 * anything a customer reads.
 *
 * The wording is deliberately factual. A surcharge is the moment a customer is most
 * likely to feel they are being worked over, and the honest defence is to say plainly
 * what triggered it — the same information the owner would give on the phone.
 */

import type { ModifierReasonCode } from '../engine/pricing'
import type { Language } from '../domain/event-brief'

function formatDate(iso: string, language: Language): string {
  const [y, m, d] = String(iso).split('-')
  if (!y || !m || !d) return String(iso)
  if (language !== 'de') return `${d}/${m}/${y}`
  const months = [
    'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
  ]
  const monthName = months[Number(m) - 1] ?? m
  return `${Number(d)}. ${monthName} ${y}`
}

export function modifierReason(
  code: ModifierReasonCode,
  params: Record<string, string | number>,
  language: Language,
): string {
  const de = language === 'de'

  switch (code) {
    case 'weekend':
      return de
        ? `Wochenendtermin (${formatDate(String(params.date), 'de')})`
        : `Weekend date (${formatDate(String(params.date), 'en')})`

    case 'peak_season':
      return de
        ? `Hauptsaison (${formatDate(String(params.date), 'de')})`
        : `Peak season (${formatDate(String(params.date), 'en')})`

    case 'rush':
      return de
        ? `Kurzfristige Buchung (unter ${params.days} Tagen Vorlauf)`
        : `Short-notice booking (under ${params.days} days' lead time)`

    case 'travel_distance':
      return de
        ? `Anfahrt ${params.km} km (ab ${params.threshold} km)`
        : `Travel ${params.km} km (from ${params.threshold} km)`

    case 'overtime':
      return de
        ? `${params.hours} Std. statt ${params.included} Std. inklusive`
        : `${params.hours} h rather than the ${params.included} h included`
  }
}
