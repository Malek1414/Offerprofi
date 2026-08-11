/**
 * The pattern observation — the only thing that ever crosses into the shared layer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS TYPE IS SHAPED THE WAY IT IS, WHICH IS THE WHOLE ARGUMENT.
 *
 * The obvious build is "crawl the site, store the page, the agent gets smarter."
 * It does not work, and it fails in a way that gets worse the harder you push it.
 * A scraped page with no verdict attached is text, not knowledge. Storing more of
 * it makes retrieval noisier, and noisier retrieval is exactly what raises the
 * fabrication rate — so the naive loop puts *no invented figures* and *smarter
 * every run* in direct opposition, and you have to pick one.
 *
 * The signal worth keeping is not the page. It is the **owner's verdict on what
 * we read off the page**. When the extractor says "the text in `h3.item > span`
 * is the item name" and the owner renames it, that correction is a labelled
 * example produced for free by the best-qualified labeller alive for that data.
 * When the extractor reads `18,50 p.P.` as a per-unit price and the owner
 * corrects it to per-person, that is German catering unit convention, learned
 * from the one person who actually knows.
 *
 * So an observation records **where we looked, what we concluded, and what the
 * owner said it really was** — and nothing else. It never carries the text we
 * read. That single omission is what lets this layer be cross-tenant at all.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `read_as` AND `corrected_to` ARE A CLOSED VOCABULARY, NOT FREE TEXT.
 *
 * This is the primary enforcement of the rule in EXECUTION_HANDOFF §4 — a price
 * may never enter the shared layer, and a shared-layer read may never introduce
 * a number into a customer-facing turn. `src/shared-layer/purity.ts` is the
 * second net, and a net is not a wall: it can only refuse what it recognises.
 * A field that admits arbitrary strings will eventually carry one, because the
 * extractor writing into it is a language model reading an adversarial web page.
 *
 * A field that admits fifteen enum members carries one of fifteen enum members.
 * `'price_per_person'` is a *role* — it says the thing at that locator is a
 * per-person price, which is knowledge about how German catering menus are
 * written and is true of every caterer in the country. `'18,50 €'` is a *value*
 * — it belongs to exactly one tenant and may never leave their RLS boundary.
 * The type system draws that line, and `ROLE_VOCABULARY` is checked digit-free
 * by test so that no future role can smuggle a quantity in its own name.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Schema per EXECUTION_HANDOFF §11: `{ source_kind, locator, read_as,
 * corrected_to, confidence_before, language }`. Snake case is kept deliberately
 * — it is the wire contract with the sidecar, and a field renamed on one side of
 * a store that outlives any single deploy is a field silently dropped.
 */

/** What kind of source the locator addresses. Determines how a locator is read. */
export const SOURCE_KINDS = [
  'html_page',
  'pdf_document',
  'spreadsheet',
  'image',
  'plain_text',
] as const

export type SourceKind = (typeof SOURCE_KINDS)[number]

/**
 * Every conclusion the extractor is allowed to reach about a locator.
 *
 * These are roles a caterer's own document assigns to a position on the page.
 * They are cross-tenant by construction: "the second column of the menu table
 * holds a per-person price" is true of thousands of German catering PDFs and
 * belongs to none of them.
 *
 * Note what is absent. There is no `other`, no `custom`, no `raw`. An escape
 * hatch on a closed vocabulary is not a closed vocabulary — it is a free-text
 * field with a discouraging name, and it would become the field that carries
 * `'Menü Müller GmbH — 18,50 € p.P.'` the first time extraction met a layout
 * nobody anticipated. When extraction meets something genuinely new, the right
 * move is to add a member here, deliberately, with a test run behind it.
 *
 * `not_a_field` is the honest way to record "we read meaning into this and the
 * owner said there was none" — a rejection, which is as much signal as a
 * correction and is the observation most likely to stop the next tenant's
 * extractor inventing a line item.
 */
export const ROLE_VOCABULARY = [
  'item_name',
  'item_description',
  'category_name',
  'price_per_person',
  'price_per_unit',
  'price_per_hour',
  'price_flat',
  'minimum_headcount',
  'minimum_order_value',
  'portion_size',
  'unit_of_measure',
  'lead_time',
  'service_area',
  'allergen_note',
  'staffing_note',
  'not_a_field',
] as const

export type ReadingRole = (typeof ROLE_VOCABULARY)[number]

/** D19 — the product speaks DE and EN, and reading conventions differ between them. */
export const LANGUAGES = ['de', 'en'] as const

export type Language = (typeof LANGUAGES)[number]

/**
 * One owner verdict, reduced to what is safe to share.
 *
 * `corrected_to === null` means the owner confirmed our reading unchanged, which
 * is the positive example and is worth as much as a correction. `corrected_to`
 * set to a different role is an edit. `corrected_to: 'not_a_field'` is a
 * rejection.
 */
export interface PatternObservation {
  source_kind: SourceKind
  /**
   * Where we looked, expressed as a *position* and never as a value.
   *
   * A CSS selector for an HTML page (`section.menu h3 > span`), a structural
   * path for a PDF (`page[2] table[1] col[3]`), a positional address for a
   * sheet (`sheet[1] col[B] row[12]`). The grammar is enforced in
   * `src/shared-layer/purity.ts`, and the single rule it exists to hold is that
   * a locator may address a position but may never quote content — because the
   * moment a selector is allowed to say `td:contains("18,50 €")`, the locator
   * field is a price field wearing a selector's clothes.
   */
  locator: string
  /** What extraction concluded the thing at that locator was. */
  read_as: ReadingRole
  /** What the owner said it actually was; `null` when they confirmed as read. */
  corrected_to: ReadingRole | null
  /**
   * Extraction's own confidence at the time, in [0, 1].
   *
   * Kept because the interesting observations are the confident wrong ones —
   * a 0.95 that the owner overturned describes a layout that *reliably fools
   * this extractor*, which is worth more than a hundred hedged guesses. It is
   * a number, and it is the reason `shared-layer-no-numbers` checks what leaves
   * this layer rather than merely what enters it.
   */
  confidence_before: number
  language: Language
}

/** The three verdicts, derived rather than stored — there is no fourth state to drift into. */
export type Verdict = 'confirmed' | 'edited' | 'rejected'

export function verdictOf(observation: PatternObservation): Verdict {
  if (observation.corrected_to === null) return 'confirmed'
  if (observation.corrected_to === 'not_a_field') return 'rejected'
  return 'edited'
}

const ROLES: ReadonlySet<string> = new Set(ROLE_VOCABULARY)
const KINDS: ReadonlySet<string> = new Set(SOURCE_KINDS)
const LANGS: ReadonlySet<string> = new Set(LANGUAGES)

export function isReadingRole(value: unknown): value is ReadingRole {
  return typeof value === 'string' && ROLES.has(value)
}

export function isSourceKind(value: unknown): value is SourceKind {
  return typeof value === 'string' && KINDS.has(value)
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && LANGS.has(value)
}

/** Why a candidate observation was not one. Reported to the caller, never stored. */
export type ShapeProblem =
  | 'not_an_object'
  | 'unknown_source_kind'
  | 'locator_not_a_string'
  | 'unknown_read_as'
  | 'unknown_corrected_to'
  | 'confidence_out_of_range'
  | 'unknown_language'
  | 'extra_field'

export type ShapeResult =
  | { ok: true; observation: PatternObservation }
  | { ok: false; problems: ShapeProblem[] }

const FIELDS = [
  'source_kind',
  'locator',
  'read_as',
  'corrected_to',
  'confidence_before',
  'language',
] as const

/**
 * Validate shape at runtime, because the type only holds where the compiler ran.
 *
 * Observations arrive from extraction — which parses a model's output — and from
 * the sidecar on the way back in. Neither is a place a TypeScript interface has
 * any authority. `as PatternObservation` costs nothing to write and would defeat
 * every argument above, so the boundary is checked in code that runs.
 *
 * Unknown fields are refused rather than stripped. Stripping is the friendlier
 * behaviour and the wrong one here: a caller who adds `raw_text` and sees it
 * silently vanish will not learn anything, whereas a caller who sees
 * `extra_field` learns that this layer has an exhaustive schema on purpose.
 */
export function parseObservation(input: unknown): ShapeResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, problems: ['not_an_object'] }
  }

  const record = input as Record<string, unknown>
  const problems: ShapeProblem[] = []

  const known: ReadonlySet<string> = new Set<string>(FIELDS)
  if (Object.keys(record).some((key) => !known.has(key))) problems.push('extra_field')

  if (!isSourceKind(record.source_kind)) problems.push('unknown_source_kind')
  if (typeof record.locator !== 'string') problems.push('locator_not_a_string')
  if (!isReadingRole(record.read_as)) problems.push('unknown_read_as')
  if (record.corrected_to !== null && !isReadingRole(record.corrected_to)) {
    problems.push('unknown_corrected_to')
  }

  const confidence = record.confidence_before
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    problems.push('confidence_out_of_range')
  }

  if (!isLanguage(record.language)) problems.push('unknown_language')

  if (problems.length > 0) return { ok: false, problems }

  return {
    ok: true,
    observation: {
      source_kind: record.source_kind as SourceKind,
      locator: record.locator as string,
      read_as: record.read_as as ReadingRole,
      corrected_to: record.corrected_to as ReadingRole | null,
      confidence_before: confidence as number,
      language: record.language as Language,
    },
  }
}
