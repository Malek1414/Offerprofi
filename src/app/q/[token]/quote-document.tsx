'use client'

/**
 * The web quote (FEATURE_INVENTORY F5.2, screen S26).
 *
 * The primary artefact. A bride opens this on a phone, next to two or three
 * competing quotes, and decides partly on whether it looks like the agency knows
 * what it is doing. Lisa's stated wish in the brief is "a quote that looks as good
 * as my Instagram", so the agency's brand carries the personality and this component
 * supplies structure, rhythm and legibility.
 *
 * Structure follows the shape of a German Angebot rather than an American SaaS
 * proposal: letterhead, subject line, itemised table with Netto/MwSt./Brutto, then
 * the legal block. That form is what the recipient expects, and meeting the
 * expectation is worth more here than novelty.
 *
 * The signature element is the calculation trace. Any line opens to show exactly how
 * it was computed — "80 Gäste × 72,00 €, Staffel 50–99". No competitor can offer
 * that, because no model-priced system can reconstruct its own arithmetic. It also
 * happens to discharge the Art. 50 explainability duty (I6), which is the nicest
 * kind of feature: the honest thing and the compliant thing are the same thing.
 */

import { useState } from 'react'

import type { QuoteLine, PricedQuote } from '../../../engine/pricing'
import { formatCents } from '../../../domain/money'
import type { QuoteLegalBlock } from '../../../domain/legal'
import { type AgencyTheme, themeStyle } from '../../../lib/theme'
import { modifierReason } from '../../../i18n/modifier-reasons'
import s from './quote.module.css'

export interface QuoteAgency {
  name: string
  legalName: string
  address: string[]
  contact: string
  taxId: string
  logoUrl: string | null
  ownerName: string
}

export interface QuoteDocumentProps {
  agency: QuoteAgency
  theme: AgencyTheme
  quote: PricedQuote
  quoteNumber: string
  issuedOn: string
  validUntil: string
  customerName: string
  eventSummary: string
  legal: QuoteLegalBlock
  language: 'de' | 'en'
  state: 'sent' | 'viewed' | 'accepted' | 'declined' | 'expired' | 'superseded'
}

const t = {
  de: {
    quote: 'Angebot',
    forEvent: 'Für Ihre Veranstaltung',
    position: 'Leistung',
    qty: 'Menge',
    unitPrice: 'Einzelpreis',
    net: 'Netto',
    subtotalNet: 'Zwischensumme netto',
    vat: 'MwSt.',
    total: 'Gesamtbetrag',
    validUntil: 'Gültig bis',
    issuedOn: 'Datum',
    number: 'Angebotsnr.',
    taxId: 'USt-IdNr.',
    howCalculated: 'Wie kommt dieser Preis zustande?',
    tier: 'Staffel',
    surcharge: 'Aufschlag',
    accepted: 'Angenommen',
    declined: 'Abgelehnt',
    expired: 'Abgelaufen',
    superseded: 'Es gibt eine neuere Fassung dieses Angebots',
    viewLatest: 'Neueste Fassung öffnen',
    questions: 'Passt etwas nicht?',
    questionsBody: 'Schreiben Sie uns — wir passen das Angebot an.',
    reply: 'Antworten',
  },
  en: {
    quote: 'Quote',
    forEvent: 'For your event',
    position: 'Service',
    qty: 'Qty',
    unitPrice: 'Unit price',
    net: 'Net',
    subtotalNet: 'Subtotal, net',
    vat: 'VAT',
    total: 'Total',
    validUntil: 'Valid until',
    issuedOn: 'Date',
    number: 'Quote no.',
    taxId: 'VAT ID',
    howCalculated: 'How is this price calculated?',
    tier: 'Tier',
    surcharge: 'Surcharge',
    accepted: 'Accepted',
    declined: 'Declined',
    expired: 'Expired',
    superseded: 'A newer version of this quote is available',
    viewLatest: 'Open the latest version',
    questions: 'Something not right?',
    questionsBody: 'Tell us — we will adjust the quote.',
    reply: 'Reply',
  },
} as const

function formatDate(iso: string, language: 'de' | 'en'): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return language === 'de' ? `${d}.${m}.${y}` : `${d}/${m}/${y}`
}

function quantityLabel(line: QuoteLine, language: 'de' | 'en'): string {
  const n = new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'en-IE').format(line.quantity)
  return `${n} ${line.unit}`
}

/** The signature element: one line's arithmetic, in words. */
function LineTrace({
  line,
  quote,
  language,
}: {
  line: QuoteLine
  quote: PricedQuote
  language: 'de' | 'en'
}) {
  const copy = t[language]
  const mods = quote.modifiers.filter((m) => m.appliedToLine === line.catalogItemId)
  const tiered = line.unitPrice !== line.listUnitPrice

  return (
    <div className={s.trace}>
      <ol>
        <li>
          <span>{quantityLabel(line, language)}</span>
          <span className="num">×&nbsp;{formatCents(line.unitPrice, language)}</span>
          <span className={`num ${s.traceResult}`}>{formatCents(line.subtotal, language)}</span>
        </li>
        {tiered && (
          <li className={s.traceNote}>
            <span>
              {copy.tier} — {formatCents(line.listUnitPrice, language)} →{' '}
              {formatCents(line.unitPrice, language)}
            </span>
          </li>
        )}
        {mods.map((m, i) => (
          <li key={`${m.modifierId}-${i}`}>
            <span>
              {copy.surcharge}: {modifierReason(m.reasonCode, m.reasonParams, language)}
            </span>
            <span className="num">
              {m.adjustmentType === 'pct' ? `+${m.value}%` : ''}
            </span>
            <span className={`num ${s.traceResult}`}>+&nbsp;{formatCents(m.delta, language)}</span>
          </li>
        ))}
        <li className={s.traceSum}>
          <span>{copy.net}</span>
          <span />
          <span className={`num ${s.traceResult}`}>{formatCents(line.net, language)}</span>
        </li>
      </ol>
    </div>
  )
}

export function QuoteDocument(props: QuoteDocumentProps) {
  const { agency, quote, theme, legal, language, state } = props
  const copy = t[language]
  const [open, setOpen] = useState<string | null>(null)

  const isClosed = state === 'accepted' || state === 'declined' || state === 'expired'

  return (
    <article className={s.doc} style={themeStyle(theme) as React.CSSProperties}>
      {state === 'superseded' && (
        <p className={`${s.banner} no-print`} role="status">
          {copy.superseded}. <a href="#latest">{copy.viewLatest}</a>
        </p>
      )}

      {/* Briefkopf */}
      <header className={s.head}>
        <div className={s.ident}>
          {agency.logoUrl ? (
            <img src={agency.logoUrl} alt={agency.name} className={s.logo} />
          ) : (
            <span className={s.wordmark}>{agency.name}</span>
          )}
          <address className={s.address}>
            {agency.legalName}
            <br />
            {agency.address.join(', ')}
            <br />
            {agency.contact}
          </address>
        </div>

        <dl className={s.meta}>
          <div>
            <dt>{copy.number}</dt>
            <dd className="num">{props.quoteNumber}</dd>
          </div>
          <div>
            <dt>{copy.issuedOn}</dt>
            <dd className="num">{formatDate(props.issuedOn, language)}</dd>
          </div>
          <div>
            <dt>{copy.validUntil}</dt>
            <dd className="num">{formatDate(props.validUntil, language)}</dd>
          </div>
          <div>
            <dt>{copy.taxId}</dt>
            <dd className="num">{agency.taxId}</dd>
          </div>
        </dl>
      </header>

      {/* Betreff */}
      <section className={s.subject}>
        <p className="eyebrow">{copy.forEvent}</p>
        <h1>{props.eventSummary}</h1>
        <p className={s.recipient}>{props.customerName}</p>
      </section>

      {/* Positionen */}
      <section aria-label={copy.position}>
        <div className={s.thead} aria-hidden="true">
          <span>{copy.position}</span>
          <span>{copy.qty}</span>
          <span>{copy.unitPrice}</span>
          <span>{copy.net}</span>
        </div>

        <ul className={s.lineList}>
          {quote.lines.map((line) => {
            const isOpen = open === line.catalogItemId
            return (
              <li key={line.catalogItemId}>
                <div className={s.row}>
                  <div className={s.what}>
                    <h2>{line.name}</h2>
                    {line.description && <p>{line.description}</p>}
                  </div>
                  <span className={`num ${s.qty}`}>{quantityLabel(line, language)}</span>
                  <span className={`num ${s.unit}`}>{formatCents(line.unitPrice, language)}</span>
                  <span className={`num ${s.net}`}>{formatCents(line.net, language)}</span>
                </div>

                <button
                  type="button"
                  className={`${s.why} no-print`}
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : line.catalogItemId)}
                >
                  <span className={s.chev} aria-hidden="true">
                    {isOpen ? '−' : '+'}
                  </span>
                  <span className={s.whyLabel}>{copy.howCalculated}</span>
                </button>

                {isOpen && <LineTrace line={line} quote={quote} language={language} />}
              </li>
            )
          })}
        </ul>
      </section>

      {/* Summen */}
      <section className={s.totals} aria-label={copy.total}>
        <dl>
          <div>
            <dt>{copy.subtotalNet}</dt>
            <dd className="num">{formatCents(quote.netTotal, language)}</dd>
          </div>
          {quote.vatBreakdown.map((v) => (
            <div key={v.rate}>
              <dt>
                {copy.vat} {v.rate}%
              </dt>
              <dd className="num">{formatCents(v.vat, language)}</dd>
            </div>
          ))}
          <div className={s.grand}>
            <dt>{copy.total}</dt>
            <dd className="num">{formatCents(quote.grossTotal, language)}</dd>
          </div>
        </dl>
      </section>

      {/* Handlung */}
      {!isClosed && (
        <section className={`${s.act} no-print`}>
          <button type="button" className={s.accept}>
            {legal.acceptLabel}
          </button>
          <p className={s.subline}>{legal.acceptSubline}</p>

          <div className={s.alt}>
            <p className={s.altQuestion}>{copy.questions}</p>
            <p className={s.altBody}>{copy.questionsBody}</p>
            <div className={s.altActions}>
              <button type="button" className={s.ghost}>
                {copy.reply}
              </button>
              {/* I5 — present on every quote, in every state. */}
              <button type="button" className={s.ghost}>
                {legal.requestHumanLabel}
              </button>
            </div>
          </div>
        </section>
      )}

      {isClosed && (
        <section className={`${s.act} ${s.closed}`}>
          <p className={s.stateLabel}>{copy[state as 'accepted' | 'declined' | 'expired']}</p>
          <button type="button" className={`${s.ghost} no-print`}>
            {legal.requestHumanLabel}
          </button>
        </section>
      )}

      {/* Rechtliches — I3 + I6. Never optional, never collapsed. */}
      <footer className={s.legal}>
        <p>{legal.nonBinding}</p>
        <p>{legal.aiDisclosure}</p>
      </footer>
    </article>
  )
}
