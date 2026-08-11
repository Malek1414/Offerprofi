/**
 * The quote as a file (A5).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY NUMBER HERE COMES FROM THE PRICING ENGINE. NONE IS COMPUTED IN THIS FILE.
 *
 * `PricedQuote` arrives fully calculated, with a trace that can reconstruct any
 * figure on it (D6). This module formats and lays out; it does not add, multiply
 * or round. A total assembled during rendering is a total nobody can defend when
 * a customer asks how it was reached, and the golden-set tests on the engine
 * would not cover it.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FILE LEAVES OUR SURFACE, SO THE MARKING TRAVELS INSIDE IT.
 *
 * On the web quote the Art. 50(2) synthetic-content marking is a JSON-LD block in
 * the page. A PDF has no DOM, and once it is an attachment on somebody's email
 * the only machine-readable channel left is the document metadata. That is why
 * `quotePdfMetadata` is not decoration.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'

import type { PricedQuote } from '../engine/pricing'
import { quoteLegalBlock } from '../domain/legal'
import { modifierReason } from '../i18n/modifier-reasons'
import { branding } from '../lib/branding'

export interface QuotePdfInput {
  agencyName: string
  ownerName: string
  /** Hex, from the agency's brand. Falls back to ink if unusable. */
  brandColor: string
  quoteNumber: string
  issuedOn: string
  validUntil: string
  customerName: string
  eventSummary: string
  language: 'de' | 'en'
  quote: PricedQuote
}

export interface QuotePdfMetadata {
  title: string
  author: string
  subject: string
  keywords: string
  creator: string
  producer: string
}

/**
 * `AIGenerated` is the keyword C2PA and the IPTC digital-source vocabulary both
 * key on, so it is the one a machine reading this file will look for. The German
 * sentence beside it is for the person who opens Document Properties.
 */
export function quotePdfMetadata(input: QuotePdfInput, issuedAt: string): QuotePdfMetadata {
  const de = input.language === 'de'
  return {
    title: `Angebot ${input.quoteNumber} — ${input.agencyName}`,
    author: input.agencyName,
    subject: de
      ? `KI-gestützt erstelltes, freibleibendes Angebot. Erstellt am ${issuedAt}. ` +
        `Verbindlich erst nach Bestätigung durch ${input.ownerName}.`
      : `AI-prepared, non-binding quote. Generated ${issuedAt}. ` +
        `Binding only after confirmation by ${input.ownerName}.`,
    keywords: 'AIGenerated, trainedAlgorithmicMedia, Angebot, freibleibend',
    creator: input.agencyName,
    producer: branding().productName,
  }
}

const euro = (cents: number, language: 'de' | 'en'): string =>
  new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'en-GB', {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100)

const HEX = /^#[0-9a-f]{6}$/i
const INK = '#1c1a17'

const styles = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 64, paddingHorizontal: 48, fontSize: 10, color: INK },
  agency: { fontSize: 18, marginBottom: 2 },
  meta: { fontSize: 9, color: '#6b645c' },
  title: { fontSize: 14, marginTop: 24, marginBottom: 2 },
  summary: { fontSize: 10, color: '#4a453f', marginBottom: 16 },
  row: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: '#e0dbd4' },
  head: { flexDirection: 'row', paddingBottom: 5, borderBottomWidth: 1 },
  cName: { flex: 4 },
  cQty: { flex: 1, textAlign: 'right' },
  cUnit: { flex: 2, textAlign: 'right' },
  cSum: { flex: 2, textAlign: 'right' },
  lineDesc: { fontSize: 8, color: '#6b645c', marginTop: 2 },
  totals: { marginTop: 14, alignItems: 'flex-end' },
  totalRow: { flexDirection: 'row', width: 240, justifyContent: 'space-between', paddingVertical: 2 },
  gross: { fontSize: 13, marginTop: 4 },
  legal: { marginTop: 28, fontSize: 8, color: '#6b645c', lineHeight: 1.5 },
  footer: { position: 'absolute', bottom: 32, left: 48, right: 48, fontSize: 7, color: '#8a827a' },
})

function QuotePdf({ input, issuedAt }: { input: QuotePdfInput; issuedAt: string }) {
  const de = input.language === 'de'
  const accent = HEX.test(input.brandColor) ? input.brandColor : INK
  const meta = quotePdfMetadata(input, issuedAt)
  const legal = quoteLegalBlock(
    { agencyName: input.agencyName, validUntil: input.validUntil, language: input.language },
    input.ownerName,
  )

  return (
    <Document
      title={meta.title}
      author={meta.author}
      subject={meta.subject}
      keywords={meta.keywords}
      creator={meta.creator}
      producer={meta.producer}
    >
      <Page size="A4" style={styles.page}>
        <Text style={[styles.agency, { color: accent }]}>{input.agencyName}</Text>
        <Text style={styles.meta}>
          {de ? 'Angebot' : 'Quote'} {input.quoteNumber} · {input.issuedOn} ·{' '}
          {de ? 'gültig bis' : 'valid until'} {input.validUntil}
        </Text>

        <Text style={styles.title}>
          {de ? 'Angebot für' : 'Quote for'} {input.customerName}
        </Text>
        <Text style={styles.summary}>{input.eventSummary}</Text>

        <View style={[styles.head, { borderBottomColor: accent }]}>
          <Text style={styles.cName}>{de ? 'Leistung' : 'Service'}</Text>
          <Text style={styles.cQty}>{de ? 'Menge' : 'Qty'}</Text>
          <Text style={styles.cUnit}>{de ? 'Einzelpreis' : 'Unit'}</Text>
          <Text style={styles.cSum}>{de ? 'Summe' : 'Total'}</Text>
        </View>

        {input.quote.lines.map((line) => (
          <View key={line.catalogItemId} style={styles.row} wrap={false}>
            <View style={styles.cName}>
              <Text>{line.name}</Text>
              {line.description ? <Text style={styles.lineDesc}>{line.description}</Text> : null}
            </View>
            <Text style={styles.cQty}>
              {line.quantity} {line.unit}
            </Text>
            <Text style={styles.cUnit}>{euro(line.unitPrice, input.language)}</Text>
            <Text style={styles.cSum}>{euro(line.subtotal, input.language)}</Text>
          </View>
        ))}

        {/* The engine emits a reason code and parameters, never a sentence — display
            text is this layer's job, and `modifierReason` is the same translator the
            web quote uses, so the two documents cannot drift apart in wording. */}
        {input.quote.modifiers.map((modifier, i) => (
          <View key={`${modifier.modifierId}-${i}`} style={styles.row} wrap={false}>
            <Text style={styles.cName}>
              {modifierReason(modifier.reasonCode, modifier.reasonParams, input.language)}
            </Text>
            <Text style={styles.cQty} />
            <Text style={styles.cUnit} />
            <Text style={styles.cSum}>{euro(modifier.delta, input.language)}</Text>
          </View>
        ))}

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text>{de ? 'Nettosumme' : 'Net total'}</Text>
            <Text>{euro(input.quote.netTotal, input.language)}</Text>
          </View>
          {input.quote.vatBreakdown.map((entry) => (
            <View key={entry.rate} style={styles.totalRow}>
              <Text>
                {de ? 'zzgl. USt.' : 'plus VAT'} {entry.rate}%
              </Text>
              <Text>{euro(entry.vat, input.language)}</Text>
            </View>
          ))}
          <View style={[styles.totalRow, styles.gross]}>
            <Text>{de ? 'Gesamt' : 'Total'}</Text>
            <Text style={{ color: accent }}>{euro(input.quote.grossTotal, input.language)}</Text>
          </View>
        </View>

        <View style={styles.legal}>
          {/* I3 and I6, printed rather than implied: freibleibend, and AI-prepared. */}
          <Text>{legal.nonBinding}</Text>
          <Text>{legal.aiDisclosure}</Text>
          <Text>{legal.acceptSubline}</Text>
        </View>

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `${meta.subject}  ·  ${pageNumber}/${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  )
}

export async function renderQuotePdf(
  input: QuotePdfInput,
  issuedAt: string = new Date().toISOString(),
): Promise<Buffer> {
  return renderToBuffer(<QuotePdf input={input} issuedAt={issuedAt} />)
}
