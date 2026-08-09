/**
 * The request document (Phase D). Two audiences, one component, one route.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SELF-CONTAINED ON PURPOSE.
 *
 * All the CSS is inline in a <style> tag, there are no imports of anything the
 * browser has to fetch, and no third-party origin appears anywhere. Three reasons,
 * in increasing order of importance: it prints to PDF as one file, it renders on a
 * phone in a kitchen with one round trip, and a page with no external requests
 * cannot leak the existence of an enquiry to anyone we did not choose to tell.
 *
 * The customer surfaces carry no analytics and no third-party scripts, which is
 * what keeps the product outside TDDDG §25's consent requirement. This page is one
 * of those surfaces. Keep it that way.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The owner's copy is the same document plus the two things only he may see: how
 * to reach her, and — when Phase B2 lands — what this event is worth. Those come
 * from the row, which has nulls in those columns for her token. This component
 * cannot leak what it was never handed.
 */

import type { ContactPartition } from '../../../domain/extracted'
import { requestLegalBlock } from '../../../domain/legal'
import { formatCents } from '../../../domain/money'
import type { AgencyTheme } from '../../../lib/theme'
import { themeStyle } from '../../../lib/theme'
import type { RequestAgency } from '../../../requests/repository'
import type { RequestAudience } from '../../../requests/links'
import type { SuggestionOutcome } from '../../../requests/suggestion'
import type { DocumentLanguage, SummaryRow } from '../../../requests/summary'

export interface RequestDocumentProps {
  audience: RequestAudience
  agency: RequestAgency
  theme: AgencyTheme
  rows: SummaryRow[]
  /** Owner audience only, and null on hers by the time it reaches this component. */
  contact: ContactPartition | null
  sentAt: string
  language: DocumentLanguage
  /**
   * Owner audience only (Phase B2).
   *
   * The route passes `null` for the customer's token and never computes one — so
   * the price block is not something this component hides from her, it is
   * something it was never given. That is the same shape as `contact`, and it is
   * what the price-leak test relies on.
   */
  suggestion?: SuggestionOutcome | null
}

export function RequestDocument(props: RequestDocumentProps) {
  const { audience, agency, rows, language } = props
  const de = language === 'de'
  const owner = audience === 'owner'
  const legal = requestLegalBlock({ agencyName: agency.name, language }, agency.ownerName)

  const title = owner
    ? de
      ? 'Neue Anfrage'
      : 'New enquiry'
    : de
      ? `Ihre Anfrage an ${agency.name}`
      : `Your enquiry to ${agency.name}`

  return (
    <article className="doc" style={themeStyle(props.theme) as React.CSSProperties}>
      <style>{CSS}</style>

      <header className="head">
        <div>
          <p className="eyebrow">{owner ? agency.name : de ? 'Anfrage' : 'Enquiry'}</p>
          <h1>{title}</h1>
        </div>
        <p className="sent">
          {de ? 'Gesendet' : 'Sent'} {formatDateTime(props.sentAt, language)}
        </p>
      </header>

      {owner && props.contact ? <ContactBlock contact={props.contact} de={de} /> : null}

      <section aria-label={de ? 'Die Anfrage' : 'The enquiry'}>
        <dl className="rows">
          {rows.map((row) => (
            <div className="row" key={row.field}>
              <dt>{row.label}</dt>
              <dd>
                {row.value}
                {row.uncertain ? (
                  <span className="check" title={de ? 'Bitte prüfen' : 'Worth checking'}>
                    {de ? 'prüfen' : 'check'}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
        {rows.length === 0 ? (
          <p className="empty">
            {de
              ? 'Zu dieser Anfrage liegt noch nichts Strukturiertes vor — das Gespräch steht im Verlauf.'
              : 'Nothing structured has been captured yet — the conversation itself is the record.'}
          </p>
        ) : null}
      </section>

      {/* Phase B2 — the suggestion. Only ever rendered for the owner, and only
          because only the owner's props carry one. */}
      {owner && props.suggestion ? (
        <SuggestionBlock outcome={props.suggestion} de={de} language={language} />
      ) : null}

      {owner ? (
        <section className="next" aria-label={de ? 'Nächster Schritt' : 'Next step'}>
          <p>
            {de
              ? 'Antworten Sie einfach in normaler Sprache — Preise, Termine, Bedingungen. ' +
                'Daraus wird ein sauberes Angebot in Ihren Worten.'
              : 'Just reply in plain language — prices, dates, conditions. That becomes a ' +
                'proper offer in your own words.'}
          </p>
        </section>
      ) : (
        <section className="next" aria-label={de ? 'Wie es weitergeht' : 'What happens next'}>
          <p>{legal.whatHappensNext}</p>
        </section>
      )}

      <footer className="foot">
        {/* Art. 50(1) and I3, on the document rather than only in the chat. */}
        <p>{legal.aiDisclosure}</p>
        <p>{owner ? legal.nothingPromised : legal.nothingBinding}</p>
        {owner ? null : (
          <p className="links">
            <a href={agency.privacyNoticeUrl}>{de ? 'Datenschutz' : 'Privacy'}</a>
            <a href={agency.imprintUrl}>{de ? 'Impressum' : 'Imprint'}</a>
          </p>
        )}
      </footer>
    </article>
  )
}

/**
 * "For this request I'd suggest €6,240 — here is each service, here is what you keep."
 *
 * Framed as a suggestion in the heading, in the body, and in the fact that the
 * next section tells him to reply in his own words. He is meant to overrule it.
 *
 * Every figure comes from the engine. Nothing is computed in this file — a total
 * added up in JSX is a second pricing path, and there is exactly one (D6).
 */
function SuggestionBlock({
  outcome,
  de,
  language,
}: {
  outcome: SuggestionOutcome
  de: boolean
  language: DocumentLanguage
}) {
  if (!outcome.ok) {
    // Never an error. He came to read an enquiry; the suggestion is the extra.
    const why = de
      ? {
          no_catalogue:
            'Für einen Preisvorschlag fehlt noch Ihre Leistungsliste — sobald die steht, rechnen wir hier mit.',
          no_match:
            'Zu dieser Anfrage passt noch keine Ihrer Leistungen eindeutig — hier wäre sonst ein Preisvorschlag.',
          unavailable: 'Der Preisvorschlag ist gerade nicht verfügbar.',
        }[outcome.reason]
      : {
          no_catalogue:
            'A price suggestion needs your service list — once it exists, it appears here.',
          no_match: 'Nothing in your list clearly matches this enquiry yet.',
          unavailable: 'The price suggestion is unavailable right now.',
        }[outcome.reason]
    return (
      <section className="suggest suggest-empty" aria-label={de ? 'Preisvorschlag' : 'Suggestion'}>
        <p className="eyebrow">{de ? 'Preisvorschlag' : 'Price suggestion'}</p>
        <p className="muted">{why}</p>
      </section>
    )
  }

  const { quote, margin, rationale, unmatched } = outcome.suggestion

  return (
    <section className="suggest" aria-label={de ? 'Preisvorschlag' : 'Price suggestion'}>
      <p className="eyebrow">{de ? 'Vorschlag — nur für Sie' : 'Suggestion — for you only'}</p>
      <p className="headline">
        {de ? 'Dafür würde ich ' : "For this I'd suggest "}
        <strong>{formatCents(quote.grossTotal, language)}</strong>
        {de ? ' vorschlagen.' : '.'}
      </p>
      {rationale ? <p className="muted">{rationale}</p> : null}

      <table className="lines">
        <thead>
          <tr>
            <th scope="col">{de ? 'Leistung' : 'Service'}</th>
            <th scope="col" className="n">
              {de ? 'Menge' : 'Qty'}
            </th>
            <th scope="col" className="n">
              {de ? 'Netto' : 'Net'}
            </th>
            <th scope="col" className="n">
              {de ? 'Ihr Anteil' : 'You keep'}
            </th>
          </tr>
        </thead>
        <tbody>
          {quote.lines.map((line) => {
            const m = margin.lines.find((x) => x.catalogItemId === line.catalogItemId)
            return (
              <tr key={line.catalogItemId}>
                <td>{line.name}</td>
                <td className="n">{line.quantity}</td>
                <td className="n">{formatCents(line.net, language)}</td>
                <td className="n">
                  {m?.margin === null || m?.margin === undefined ? (
                    <span className="unknown">{de ? 'Kosten fehlen' : 'no cost'}</span>
                  ) : (
                    <>
                      {formatCents(m.margin, language)}
                      {m.marginPct === null ? null : <span className="pct"> {m.marginPct}%</span>}
                    </>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={2}>
              {de ? 'Netto gesamt' : 'Net total'}
            </th>
            <td className="n">{formatCents(quote.netTotal, language)}</td>
            <td className="n">
              {margin.hasAnyCost ? (
                <>
                  <strong>{formatCents(margin.margin, language)}</strong>
                  {margin.marginPct === null ? null : (
                    <span className="pct"> {margin.marginPct}%</span>
                  )}
                </>
              ) : (
                <span className="unknown">—</span>
              )}
            </td>
          </tr>
          <tr>
            <th scope="row" colSpan={2}>
              {de ? 'Brutto' : 'Gross'}
            </th>
            <td className="n">{formatCents(quote.grossTotal, language)}</td>
            <td />
          </tr>
        </tfoot>
      </table>

      {/* An omission that flattered the margin would be the one way this misleads
          him, so the gap is named rather than absorbed. */}
      {margin.unknownCostLines.length ? (
        <p className="muted small">
          {de
            ? `Ohne hinterlegte Kosten: ${margin.unknownCostLines.map((l) => l.name).join(', ')} — dafür ist kein Anteil berechnet.`
            : `No cost recorded for: ${margin.unknownCostLines.map((l) => l.name).join(', ')} — nothing is claimed about those.`}
        </p>
      ) : null}

      {unmatched.length ? (
        <p className="muted small">
          {de ? 'Nicht abgedeckt: ' : 'Not covered: '}
          {unmatched.join(', ')}
        </p>
      ) : null}

      <p className="muted small">
        {de
          ? 'Vorschlag aus Ihrer eigenen Preisliste. Die Kundin sieht davon nichts.'
          : 'Suggested from your own price list. The customer sees none of this.'}
      </p>
    </section>
  )
}

function ContactBlock({ contact, de }: { contact: ContactPartition; de: boolean }) {
  const lines = [contact.company, contact.email, contact.phoneE164].filter(Boolean) as string[]
  return (
    <section className="contact" aria-label={de ? 'Kontakt' : 'Contact'}>
      <p className="eyebrow">{de ? 'Von' : 'From'}</p>
      <p className="who">{contact.name ?? (de ? 'Ohne Namen' : 'No name given')}</p>
      {lines.length ? <p className="how">{lines.join(' · ')}</p> : null}
    </section>
  )
}

function formatDateTime(iso: string, language: DocumentLanguage): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(language === 'de' ? 'de-DE' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

/**
 * One stylesheet, inline, scoped under `.doc`.
 *
 * Deliberately not a CSS module: this document has to survive being saved as one
 * file and printed to PDF, and a build-time class hash is one more thing between
 * the markup and the paper.
 */
const CSS = `
.doc {
  --ink: #14171c;
  --muted: #5b6472;
  --line: #e4e7ec;
  --paper: #ffffff;
  /* The light-scheme half of the theme. The dark half is swapped in at the bottom,
     the same way the quote document does it — a caterer opening this at 23:00 on a
     phone in dark mode should not be handed a white page. */
  --brand-ink: var(--brand-ink-l);
  --brand-wash: var(--brand-wash-l);
  max-width: 44rem;
  margin: 0 auto;
  padding: 2rem 1.25rem 3rem;
  background: var(--paper);
  color: var(--ink);
  font: 400 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-text-size-adjust: 100%;
}
.doc h1 { font-size: 1.5rem; line-height: 1.2; margin: 0.1rem 0 0; font-weight: 650; }
.doc .eyebrow {
  margin: 0; font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--brand-ink, var(--muted)); font-weight: 600;
}
.doc .head {
  display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem;
  padding-bottom: 1rem; border-bottom: 3px solid var(--brand, var(--ink));
}
.doc .sent { margin: 0; font-size: 0.8125rem; color: var(--muted); white-space: nowrap; }
.doc .contact {
  margin: 1.25rem 0 0; padding: 0.875rem 1rem;
  background: var(--brand-wash, #f6f7f9); border-radius: 0.5rem;
}
.doc .contact .who { margin: 0.15rem 0 0; font-weight: 600; }
.doc .contact .how { margin: 0.15rem 0 0; color: var(--muted); font-size: 0.9375rem; }
.doc .rows { margin: 1.5rem 0 0; }
.doc .row {
  display: grid; grid-template-columns: 9.5rem 1fr; gap: 0.75rem;
  padding: 0.6rem 0; border-bottom: 1px solid var(--line);
}
.doc dt { color: var(--muted); font-size: 0.9375rem; }
.doc dd { margin: 0; overflow-wrap: anywhere; }
.doc .check {
  display: inline-block; margin-left: 0.5rem; padding: 0.05rem 0.4rem;
  border: 1px solid var(--line); border-radius: 0.25rem;
  font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted);
}
.doc .empty { color: var(--muted); }
/* Phase B2 — the suggestion. Visually a panel, not part of the request: he is
   meant to read it as advice he overrules, not as a figure already committed. */
.doc .suggest {
  margin-top: 1.75rem; padding: 1rem;
  background: var(--brand-wash, #f6f7f9);
  border: 1px solid var(--line); border-radius: 0.5rem;
}
.doc .suggest .headline { margin: 0.35rem 0 0; font-size: 1.125rem; }
.doc .suggest .muted { margin: 0.4rem 0 0; color: var(--muted); }
.doc .suggest .small { font-size: 0.8125rem; }
.doc .suggest-empty .muted { margin-top: 0.25rem; }
.doc .lines { width: 100%; margin-top: 0.9rem; border-collapse: collapse; font-size: 0.9375rem; }
.doc .lines th, .doc .lines td { padding: 0.4rem 0.3rem; text-align: left; }
.doc .lines thead th {
  font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--muted); font-weight: 600; border-bottom: 1px solid var(--line);
}
.doc .lines tbody td { border-bottom: 1px solid var(--line); }
.doc .lines tfoot th, .doc .lines tfoot td { padding-top: 0.6rem; }
.doc .lines .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.doc .lines .pct { color: var(--muted); font-size: 0.8125rem; }
.doc .lines .unknown { color: var(--muted); font-size: 0.8125rem; }
.doc .next { margin-top: 1.5rem; padding: 0.9rem 1rem; border-left: 3px solid var(--brand, var(--ink)); }
.doc .next p { margin: 0; }
.doc .foot { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--line); }
.doc .foot p { margin: 0 0 0.5rem; font-size: 0.8125rem; color: var(--muted); }
.doc .links a { color: var(--muted); margin-right: 1rem; }
@media (max-width: 30rem) {
  .doc .row { grid-template-columns: 1fr; gap: 0.1rem; }
  .doc .head { flex-direction: column; }
  /* He reads this standing in a kitchen. The table scrolls rather than the page. */
  .doc .suggest { overflow-x: auto; }
  .doc .lines { min-width: 22rem; }
}
@media (prefers-color-scheme: dark) {
  .doc {
    --ink: #eceef2;
    --muted: #9aa3b2;
    --line: #2b3038;
    --paper: #14171c;
    --brand-ink: var(--brand-ink-d);
    --brand-wash: var(--brand-wash-d);
  }
}
@media print {
  .doc {
    max-width: none; padding: 0;
    --ink: #14171c; --muted: #5b6472; --line: #e4e7ec; --paper: #ffffff;
    --brand-ink: var(--brand-ink-l); --brand-wash: var(--brand-wash-l);
  }
  .doc .next { break-inside: avoid; }
}
`
