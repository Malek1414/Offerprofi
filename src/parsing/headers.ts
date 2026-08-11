/**
 * Working out which column is which — and never deciding it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS MODULE CANNOT PRODUCE A MAPPING. IT CAN ONLY PRODUCE A PROPOSAL.
 *
 * EXECUTION_HANDOFF §6 B2: column mapping is "detected, then confirmed — never
 * guessed silently". That is a statement about the type, not about the UI. A
 * function returning `Record<ProspectField, number>` has already decided; whether a
 * screen happens to show the decision before acting on it is then a property of a
 * screen, and screens get refactored. So the return type carries a confidence on
 * every proposal, the alternatives that lost, and a `requiresConfirmation: true`
 * that is a literal type rather than a boolean — there is no value of this type
 * that says "confirmed", so no caller can obtain one from here.
 *
 * The confidence cap is the same argument. CLAUDE.md §7: "Owner- and form-supplied
 * values are 1.0 and always win." A detection therefore stops at 0.95. The gap is
 * not caution about the matching, it is a reserved value: 1.0 has one meaning in
 * this codebase and it is *a human said so*. A detector that could reach it would
 * make the two indistinguishable one refactor later.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HEADER ROW IS NOT ROW 1, AND ASSUMING IT IS BREAKS ON REAL EXPORTS.
 *
 * A list that came out of a CRM, a trade-association directory or somebody's own
 * spreadsheet opens with a title (`Leads Berlin Q3 2026`), often a blank row, often
 * a filter note, and *then* the header. Taking row 1 on faith maps `Firma` to the
 * data and the title to the header, and the result is one prospect named
 * "Leads Berlin Q3 2026" plus a mapping nobody can make sense of.
 *
 * Rows are scored instead, on four signals that separate a header from its
 * neighbours: how many cells name something we recognise, how wide the row is
 * against the widest row in the file, whether the row below looks like data, and
 * how much of the row *is* data — a URL or a bare number in a cell is strong
 * evidence against, because headers are words.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type ProspectField = 'business_name' | 'website_url' | 'city' | 'country' | 'category'

export const PROSPECT_FIELDS: readonly ProspectField[] = [
  'business_name',
  'website_url',
  'city',
  'country',
  'category',
]

/** Why a column was proposed. A code, not a sentence, so `src/i18n` owns the wording. */
export type MappingEvidence =
  /** The whole header equals a label we know for this field. */
  | 'header_exact'
  /** One word of the header equals such a label — `Firmen-Name`, `PLZ Ort`. */
  | 'header_token'
  /** The header equals a label that is suggestive but not decisive — bare `Name`. */
  | 'header_ambiguous'
  /** A word of the header equals such a label. */
  | 'header_ambiguous_token'
  /** The values below the header look like what this field holds. */
  | 'values_match_shape'

export interface FieldCandidate {
  field: ProspectField
  confidence: number
  evidence: MappingEvidence[]
}

export interface ColumnReading {
  columnIndex: number
  /** The header cell as written, umlauts and all — this is what the owner will see. */
  header: string
  /** Every field this column could be, best first. Empty when nothing matched. */
  candidates: FieldCandidate[]
  /**
   * Set when the header names something recognised that this product does not
   * import — `PLZ`, `Telefon`, `Ansprechpartner`. Recording it is what stops a
   * postcode column from drifting into `city` on a loose match, and it tells the
   * confirmation screen the column was understood and skipped rather than missed.
   */
  recognisedAs?: string
}

export interface FieldProposal {
  field: ProspectField
  columnIndex: number
  header: string
  confidence: number
  evidence: MappingEvidence[]
  /** Other columns that could be this field, best first. Never silently discarded. */
  alternatives: Array<{ columnIndex: number; header: string; confidence: number }>
}

export interface MappingProposal {
  /** Index into the rows passed in. -1 when the input had no usable row at all. */
  headerRowIndex: number
  headerRowConfidence: number
  /** Runners-up, best first, so a wrong pick is one tap to correct. */
  headerRowAlternatives: Array<{ index: number; confidence: number }>
  columns: ColumnReading[]
  proposals: FieldProposal[]
  /** Target fields no column was proposed for. */
  missing: ProspectField[]
  /** Structural, not advisory. See the header comment. */
  requiresConfirmation: true
}

/**
 * The ceiling on anything this module infers. 1.0 belongs to the owner.
 * `src/onboarding` treats ≥0.8 as good enough to pre-select and <0.5 as
 * always-ask; both thresholds sit below this, which is what makes the cap free.
 */
export const MAX_DETECTED_CONFIDENCE = 0.95

const HEADER_SCAN_ROWS = 25
const VALUE_SAMPLE_ROWS = 20

/* ────────────────────────── German-aware normalisation ────────────────────────── */

/**
 * `Ort` and `ORT` and `Ort ` are the same header. So are `Webseite` and `WEBSEITE`,
 * and — this is the German part — `Größe` and `Groesse`, because whether an umlaut
 * survives an export depends on the tool that wrote it. Transliterating before
 * stripping accents is the order that matters: NFD-stripping first would turn `ü`
 * into `u` and `Bürostadt` into `burostadt`, which matches nothing.
 */
function fold(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/** `Firmen-Name` → `firmenname`. Punctuation and spacing carry no meaning here. */
function normaliseHeader(value: string): string {
  return fold(value).replace(/[^a-z0-9]+/g, '')
}

/** `PLZ / Ort` → `['plz', 'ort']`. */
function tokenise(value: string): string[] {
  return fold(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0)
}

/* ────────────────────────────── the label table ────────────────────────────── */

/**
 * Labels are matched by equality — whole header or whole word — and never by
 * substring. Substring matching is the obvious shortcut and it is wrong in this
 * exact vocabulary: `Ort` is a substring of `Sortiment`, `Land` of `Landkreis` and
 * `Inland`, `Art` of `Artikelnummer`. Every one of those is a plausible column in a
 * German business list, and each would produce a confident mapping to the wrong
 * place. Word-level equality gets `Web-Seite` and `PLZ Ort` for free without any of
 * that.
 */
const STRONG_LABELS: Record<ProspectField, readonly string[]> = {
  business_name: [
    'firma', 'firmen', 'firmenname', 'firmenbezeichnung', 'unternehmen', 'unternehmensname',
    'betrieb', 'betriebsname', 'geschaeft', 'geschaeftsname', 'namedesunternehmens',
    'company', 'companyname', 'businessname', 'business', 'organisation', 'organization',
    'anbieter',
    // `Caterer`, `Agentur` and `Restaurant` are deliberately absent. They read as
    // business-name labels and they are far more often *values* in a category
    // column — and every label here is also consulted when scoring which row is the
    // header, so a vocabulary of industry words makes a data row look like one.
  ],
  website_url: [
    'webseite', 'website', 'webadresse', 'internetseite', 'internetadresse', 'internet',
    'homepage', 'url', 'weburl', 'websiteurl', 'web', 'domain', 'link', 'onlineauftritt',
  ],
  city: ['ort', 'stadt', 'city', 'town', 'standort', 'sitz', 'location', 'wohnort', 'firmensitz'],
  country: [
    'land', 'country', 'staat', 'nation', 'laendercode', 'countrycode', 'laenderkuerzel',
    'isocode', 'landiso',
  ],
  category: [
    'kategorie', 'branche', 'branchen', 'category', 'industry', 'sector', 'sektor',
    'gewerbe', 'segment', 'geschaeftsfeld', 'leistungsart',
  ],
}

/**
 * Suggestive, not decisive. A bare `Name` column in an agency's list is usually the
 * business and sometimes the contact person, and `Typ` is usually the category and
 * sometimes the legal form. These map at a confidence deliberately below the 0.8
 * auto-accept line, so they always reach a human.
 */
const AMBIGUOUS_LABELS: Record<ProspectField, readonly string[]> = {
  business_name: ['name', 'bezeichnung', 'titel', 'title', 'label'],
  website_url: ['seite', 'site', 'page'],
  city: ['stadtteil', 'bezirk', 'region', 'gebiet'],
  country: ['region', 'markt'],
  category: ['art', 'typ', 'type', 'sparte', 'kategorien', 'tags', 'tag'],
}

/**
 * Recognised and not imported.
 *
 * This list has one job: stop a column we understand perfectly well from being
 * offered as something it is not. Without `plz` in here, `PLZ` reaches the value
 * heuristics as an unknown header, and a column of five-digit numbers next to a
 * column of city names is exactly the kind of thing a shape heuristic gets creative
 * about. It also lets the confirmation screen say "erkannt, nicht importiert"
 * instead of leaving the column blank and unexplained.
 */
const NOT_IMPORTED: Record<string, readonly string[]> = {
  postal_code: ['plz', 'postleitzahl', 'postcode', 'zip', 'zipcode', 'postalcode'],
  // `Adresse` sits here rather than under `website_url`: in a German business list
  // it is the postal address roughly always and the web address roughly never.
  street: ['strasse', 'street', 'hausnummer', 'anschrift', 'adresse', 'adresszeile'],
  phone: ['telefon', 'tel', 'telefonnummer', 'phone', 'mobil', 'handy', 'fax'],
  email: ['email', 'mail', 'emailadresse', 'mailadresse'],
  contact_person: ['ansprechpartner', 'kontakt', 'contact', 'inhaber', 'geschaeftsfuehrer', 'owner'],
  identifier: ['id', 'nr', 'nummer', 'lfdnr', 'index', 'kundennummer'],
  notes: ['notiz', 'notizen', 'bemerkung', 'kommentar', 'notes', 'comment'],
  rating: ['bewertung', 'rating', 'sterne', 'stars', 'reviews', 'rezensionen'],
  social: ['instagram', 'facebook', 'linkedin', 'social'],
}

const CONFIDENCE: Record<MappingEvidence, number> = {
  header_exact: 0.95,
  header_token: 0.85,
  header_ambiguous: 0.7,
  header_ambiguous_token: 0.55,
  values_match_shape: 0.6,
}

/** What a value-shape match adds to a header match that already exists. */
const SHAPE_BONUS = 0.1

/* ────────────────────────────── value shapes ────────────────────────────── */

const URL_SHAPE = /^(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$|\?)/i
const COUNTRY_CODE = /^[a-z]{2,3}$/i
const COUNTRY_NAMES = new Set([
  'deutschland', 'oesterreich', 'schweiz', 'germany', 'austria', 'switzerland',
  'de', 'at', 'ch', 'deu', 'aut', 'che', 'luxemburg', 'luxembourg', 'liechtenstein',
])
const NUMERIC_SHAPE = /^[+-]?[\d.,\s]+$/

function looksLikeUrl(value: string): boolean {
  return URL_SHAPE.test(value.trim())
}

function looksLikeCountry(value: string): boolean {
  const folded = fold(value).replace(/[^a-z]/g, '')
  if (COUNTRY_NAMES.has(folded)) return true
  // A bare two-letter code is a country only where a country is plausible; the
  // caller already restricts this to columns whose header said nothing useful.
  return COUNTRY_CODE.test(folded) && folded.length === 2
}

/**
 * Three values is the floor for shape evidence.
 *
 * One row of `DE` is not a country column, it is one cell that happens to have two
 * letters — and a file whose first data row is the only one sampled would produce a
 * confident mapping off a single coincidence. Below the floor the shape says
 * nothing and contributes nothing.
 */
const MIN_SHAPE_SAMPLE = 3

function shapeFraction(values: readonly string[], test: (value: string) => boolean): number {
  const present = values.filter((value) => value.trim() !== '')
  if (present.length < MIN_SHAPE_SAMPLE) return 0
  return present.filter(test).length / present.length
}

/* ────────────────────────── header-row detection ────────────────────────── */

function isRecognisedLabel(normalised: string, words: readonly string[]): boolean {
  for (const field of PROSPECT_FIELDS) {
    if (STRONG_LABELS[field].includes(normalised)) return true
    if (AMBIGUOUS_LABELS[field].includes(normalised)) return true
    if (words.some((word) => STRONG_LABELS[field].includes(word))) return true
  }
  for (const labels of Object.values(NOT_IMPORTED)) {
    if (labels.includes(normalised)) return true
    if (words.some((word) => labels.includes(word))) return true
  }
  return false
}

function looksLikeData(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '') return false
  if (looksLikeUrl(trimmed)) return true
  if (NUMERIC_SHAPE.test(trimmed) && /\d/.test(trimmed)) return true
  if (trimmed.includes('@')) return true
  // Headers are labels. A cell of prose is a sentence from somebody's notes column.
  return trimmed.length > 48
}

function scoreHeaderRow(
  rows: readonly (readonly string[])[],
  index: number,
  widestRow: number,
): number {
  const row = rows[index] ?? []
  const populated = row.filter((cell) => cell.trim() !== '')
  if (populated.length === 0) return 0

  let labelHits = 0
  let dataHits = 0
  for (const cell of populated) {
    if (isRecognisedLabel(normaliseHeader(cell), tokenise(cell))) labelHits++
    if (looksLikeData(cell)) dataHits++
  }

  const labelRatio = labelHits / populated.length
  const dataRatio = dataHits / populated.length
  const widthRatio = widestRow === 0 ? 0 : Math.min(1, populated.length / widestRow)

  // A header is followed by data. A title row is followed by a blank, and the last
  // row of a file is followed by nothing — both correctly lose this term.
  const below = rows[index + 1] ?? []
  const belowPopulated = below.filter((cell) => cell.trim() !== '').length
  const followed = belowPopulated >= Math.max(1, populated.length - 1) ? 1 : 0

  return labelRatio * 0.6 + widthRatio * 0.25 + followed * 0.15 - dataRatio * 0.5
}

export function detectHeaderRow(rows: readonly (readonly string[])[]): {
  index: number
  confidence: number
  alternatives: Array<{ index: number; confidence: number }>
} {
  const limit = Math.min(rows.length, HEADER_SCAN_ROWS)
  let widestRow = 0
  for (const row of rows) {
    widestRow = Math.max(widestRow, row.filter((cell) => cell.trim() !== '').length)
  }

  const scored: Array<{ index: number; confidence: number }> = []
  for (let index = 0; index < limit; index++) {
    const score = scoreHeaderRow(rows, index, widestRow)
    if (score > 0) {
      scored.push({ index, confidence: Math.min(MAX_DETECTED_CONFIDENCE, Math.max(0, score)) })
    }
  }

  if (scored.length === 0) return { index: -1, confidence: 0, alternatives: [] }

  // Earliest wins a tie: a repeated header block further down is a continuation,
  // and the rows above the first one are the only ones we would otherwise skip.
  scored.sort((a, b) => (b.confidence === a.confidence ? a.index - b.index : b.confidence - a.confidence))
  const [best, ...rest] = scored
  if (!best) return { index: -1, confidence: 0, alternatives: [] }
  return { index: best.index, confidence: best.confidence, alternatives: rest.slice(0, 3) }
}

/* ────────────────────────── column reading ────────────────────────── */

function readColumn(header: string, values: readonly string[], columnIndex: number): ColumnReading {
  const normalised = normaliseHeader(header)
  const words = tokenise(header)

  // A column is set aside only when the *whole* header names something we do not
  // import — either as one word, or as a header whose every word does. Matching on
  // any single word would be too greedy in both directions: `Firma ID` would be
  // filed as an identifier and lost, while `PLZ Ort` — one column holding both —
  // still reaches the city matcher below and lands in front of a human at 0.85,
  // which is where a genuinely ambiguous column belongs.
  for (const [meaning, labels] of Object.entries(NOT_IMPORTED)) {
    const whole = normalised !== '' && labels.includes(normalised)
    const everyWord = words.length > 0 && words.every((word) => labels.includes(word))
    if (whole || everyWord) {
      return { columnIndex, header, candidates: [], recognisedAs: meaning }
    }
  }

  const byField = new Map<ProspectField, { confidence: number; evidence: MappingEvidence[] }>()
  const record = (field: ProspectField, evidence: MappingEvidence, confidence: number): void => {
    const existing = byField.get(field)
    if (!existing) {
      byField.set(field, { confidence, evidence: [evidence] })
      return
    }
    // Several signals agreeing is worth more than the best of them alone, but only
    // a little: two ways of reading the same word is not two independent facts.
    existing.evidence.push(evidence)
    existing.confidence = Math.min(
      MAX_DETECTED_CONFIDENCE,
      Math.max(existing.confidence, confidence) +
        (evidence === 'values_match_shape' ? SHAPE_BONUS : SHAPE_BONUS / 2),
    )
  }

  for (const field of PROSPECT_FIELDS) {
    const strong = STRONG_LABELS[field]
    const ambiguous = AMBIGUOUS_LABELS[field]

    if (normalised !== '' && strong.includes(normalised)) {
      record(field, 'header_exact', CONFIDENCE.header_exact)
    } else if (words.some((word) => strong.includes(word))) {
      record(field, 'header_token', CONFIDENCE.header_token)
    } else if (normalised !== '' && ambiguous.includes(normalised)) {
      record(field, 'header_ambiguous', CONFIDENCE.header_ambiguous)
    } else if (words.some((word) => ambiguous.includes(word))) {
      record(field, 'header_ambiguous_token', CONFIDENCE.header_ambiguous_token)
    }
  }

  // Value shapes run last and only for the two fields whose contents have a shape.
  // A city and a business name and a category are all "a short piece of text", so a
  // shape rule for them would be a guess dressed as evidence.
  if (shapeFraction(values, looksLikeUrl) >= 0.6) {
    record('website_url', 'values_match_shape', CONFIDENCE.values_match_shape)
  }
  if (shapeFraction(values, looksLikeCountry) >= 0.8) {
    record('country', 'values_match_shape', CONFIDENCE.values_match_shape)
  }

  const candidates: FieldCandidate[] = [...byField.entries()]
    .map(([field, reading]) => ({
      field,
      confidence: Math.min(MAX_DETECTED_CONFIDENCE, Number(reading.confidence.toFixed(4))),
      evidence: reading.evidence,
    }))
    .sort((a, b) => b.confidence - a.confidence)

  return { columnIndex, header, candidates }
}

/* ────────────────────────────── entry point ────────────────────────────── */

export function proposeMapping(rows: readonly (readonly string[])[]): MappingProposal {
  const header = detectHeaderRow(rows)

  if (header.index < 0) {
    return {
      headerRowIndex: -1,
      headerRowConfidence: 0,
      headerRowAlternatives: [],
      columns: [],
      proposals: [],
      missing: [...PROSPECT_FIELDS],
      requiresConfirmation: true,
    }
  }

  const headerRow = rows[header.index] ?? []
  const dataRows = rows.slice(header.index + 1, header.index + 1 + VALUE_SAMPLE_ROWS)

  const columns = headerRow.map((cell, columnIndex) =>
    readColumn(
      cell,
      dataRows.map((row) => row[columnIndex] ?? ''),
      columnIndex,
    ),
  )

  const proposals: FieldProposal[] = []
  for (const field of PROSPECT_FIELDS) {
    const contenders = columns
      .map((column) => ({ column, candidate: column.candidates.find((c) => c.field === field) }))
      .filter((entry): entry is { column: ColumnReading; candidate: FieldCandidate } =>
        entry.candidate !== undefined,
      )
      .sort((a, b) => b.candidate.confidence - a.candidate.confidence)

    const [winner, ...losers] = contenders
    if (!winner) continue

    proposals.push({
      field,
      columnIndex: winner.column.columnIndex,
      header: winner.column.header,
      confidence: winner.candidate.confidence,
      evidence: winner.candidate.evidence,
      alternatives: losers.map((loser) => ({
        columnIndex: loser.column.columnIndex,
        header: loser.column.header,
        confidence: loser.candidate.confidence,
      })),
    })
  }

  return {
    headerRowIndex: header.index,
    headerRowConfidence: header.confidence,
    headerRowAlternatives: header.alternatives,
    columns,
    proposals,
    missing: PROSPECT_FIELDS.filter((field) => !proposals.some((p) => p.field === field)),
    requiresConfirmation: true,
  }
}
