/**
 * Legal framing on the quote (PRODUCT_SPEC §8.3, decisions D9 + D25).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INVARIANTS 3 AND 6 LIVE HERE.
 *
 * These two paragraphs appear on every quote, in both representations, and there is
 * no configuration flag that removes them. That is intentional and it is not
 * negotiable — a tenant setting to "clean up the small print" would break invariant 3
 * for every customer of that agency at once.
 *
 * The paragraphs do four jobs between them:
 *   1. §145 BGB — the quote is *freibleibend*, so no binding offer is created
 *      automatically and nothing the agent does forms a contract.
 *   2. AI Act Art. 50 transparency — in application since 2 August 2026, enforceable
 *      now, exposure up to €15M or 3% of worldwide turnover.
 *   3. Evidence that the process is not solely automated (Art. 22, "solely" limb).
 *   4. The standing human-intervention route.
 *
 * This is not copy. It is the product's legal position, rendered.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type Language = 'de' | 'en'

export interface LegalTextParams {
  agencyName: string
  /** Rendered as TT.MM.JJJJ (de) or DD/MM/YYYY (en). */
  validUntil: string
  language: Language
}

/** Version every string, so what a given customer was shown on a given day is provable. */
export const LEGAL_TEXT_VERSION = '2026-08-08.1'

function formatDate(iso: string, language: Language): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return language === 'de' ? `${d}.${m}.${y}` : `${d}/${m}/${y}`
}

/**
 * The non-binding clause. §145 BGB: a *freibleibend* quote is an invitation to treat,
 * not an offer capable of acceptance, so the customer clicking "Angebot annehmen"
 * cannot form a contract on its own.
 */
export function nonBindingClause(p: LegalTextParams): string {
  const until = formatDate(p.validUntil, p.language)
  return p.language === 'de'
    ? `Dieses Angebot ist freibleibend und unverbindlich. Ein Vertrag kommt erst mit ` +
        `ausdrücklicher Bestätigung durch ${p.agencyName} zustande. Gültig bis ${until}.`
    : `This quote is non-binding. A contract is formed only upon express confirmation ` +
        `by ${p.agencyName}. Valid until ${until}.`
}

/**
 * The AI disclosure clause. Note it also states the human-review step and the route
 * to a person — that is what carries the Art. 22 "not solely automated" argument on
 * the document itself, where a regulator would look first.
 */
export function aiDisclosureClause(p: LegalTextParams): string {
  return p.language === 'de'
    ? `Dieses Angebot wurde mithilfe eines KI-Assistenten auf Basis Ihrer Angaben und der ` +
        `Preisliste von ${p.agencyName} erstellt und wird vor Bestätigung von ${p.agencyName} ` +
        `geprüft. Sie können jederzeit direkt mit ${p.agencyName} sprechen.`
    : `This quote was prepared with the help of an AI assistant, based on your information ` +
        `and ${p.agencyName}'s price list, and is reviewed by ${p.agencyName} before ` +
        `confirmation. You can speak to ${p.agencyName} directly at any time.`
}

export interface QuoteLegalBlock {
  version: string
  nonBinding: string
  aiDisclosure: string
  acceptLabel: string
  acceptSubline: string
  requestHumanLabel: string
}

/**
 * Everything the quote renderer must print. Returned as one object so a renderer
 * cannot pick up half of it — omitting the AI paragraph while keeping the
 * *freibleibend* one would pass a naive review and fail Art. 50.
 */
export function quoteLegalBlock(p: LegalTextParams, ownerName: string): QuoteLegalBlock {
  const de = p.language === 'de'
  return {
    version: LEGAL_TEXT_VERSION,
    nonBinding: nonBindingClause(p),
    aiDisclosure: aiDisclosureClause(p),
    // "Annehmen" reads naturally to a customer while remaining, legally, an
    // invitation to contract — the sub-line is what makes that explicit.
    acceptLabel: de ? 'Angebot annehmen' : 'Accept quote',
    acceptSubline: de
      ? 'Ihre Zusage — wir bestätigen Ihnen die Buchung verbindlich per E-Mail.'
      : 'Your acceptance — we will confirm the booking bindingly by email.',
    requestHumanLabel: de ? `mit ${ownerName} sprechen` : `Speak to ${ownerName}`,
  }
}

export interface RequestLegalBlock {
  version: string
  /** I3 — nothing here is an offer, so nothing here can be accepted into a contract. */
  nothingBinding: string
  /**
   * The same fact, told to the caterer, who needs the opposite half of it: that he
   * is free. Addressed to him — the customer-facing sentence says "Ihnen", which on
   * his copy would be talking to the wrong person about the wrong thing.
   */
  nothingPromised: string
  /** Art. 50(1) — she is told, on the document, that an assistant wrote it. */
  aiDisclosure: string
  /** What happens next, in one sentence. The SLA promise lives elsewhere (§9.8). */
  whatHappensNext: string
}

/**
 * The legal block for a *request*, which is not a quote and must not read like one.
 *
 * `quoteLegalBlock` says a contract forms on confirmation and offers an accept
 * button. None of that is true here: no price exists yet, nobody has offered
 * anything, and the only thing that has happened is that a description of an event
 * has been passed to a caterer. Reusing the quote wording would put "freibleibend"
 * on a document with nothing to be free of — which reads as though a price were
 * being withheld.
 */
export function requestLegalBlock(
  p: Pick<LegalTextParams, 'agencyName' | 'language'>,
  ownerName: string,
): RequestLegalBlock {
  return p.language === 'de'
    ? {
        version: LEGAL_TEXT_VERSION,
        nothingBinding:
          `Diese Zusammenfassung ist kein Angebot und keine Buchung. Sie enthält keine ` +
          `Preise. Verbindlich wird nichts, bevor ${p.agencyName} Ihnen ein Angebot ` +
          `gemacht und Sie es angenommen haben.`,
        nothingPromised:
          `Der Kundin wurde kein Preis genannt und nichts zugesagt. Was Sie anbieten ` +
          `und zu welchem Preis, entscheiden allein Sie.`,
        aiDisclosure:
          `Diese Zusammenfassung wurde von einem KI-Assistenten aus Ihrem Gespräch ` +
          `erstellt. ${ownerName} liest sie persönlich.`,
        whatHappensNext:
          `${ownerName} sieht Ihre Anfrage und meldet sich mit einem Angebot — mit ` +
          `Preisen, die ${ownerName} selbst festlegt.`,
      }
    : {
        version: LEGAL_TEXT_VERSION,
        nothingBinding:
          `This summary is not an offer and not a booking. It contains no prices. ` +
          `Nothing is binding until ${p.agencyName} has made you an offer and you have ` +
          `accepted it.`,
        nothingPromised:
          `No price has been quoted to her and nothing has been promised. What you ` +
          `offer, and at what price, is entirely yours to decide.`,
        aiDisclosure:
          `This summary was prepared by an AI assistant from your conversation. ` +
          `${ownerName} reads it personally.`,
        whatHappensNext:
          `${ownerName} has your enquiry and will come back with an offer — at prices ` +
          `${ownerName} sets personally.`,
      }
}

/**
 * AI Act Art. 50(2) machine-readable marking of synthetic content.
 *
 * The limited exception delays this to 2 December 2026 for systems already on the
 * market before 2 August 2026. A product launching after that date implements it
 * from the start rather than scheduling a migration it will forget.
 */
export interface SyntheticContentMarking {
  'ai-generated': true
  'generator': string
  'generated-at': string
  'human-review-required': true
  'disclosure-version': string
}

export function syntheticContentMarking(generatedAt: string): SyntheticContentMarking {
  return {
    'ai-generated': true,
    generator: 'quote-automation',
    'generated-at': generatedAt,
    'human-review-required': true,
    'disclosure-version': LEGAL_TEXT_VERSION,
  }
}
