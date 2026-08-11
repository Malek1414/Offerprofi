/**
 * Purity — the deterministic gate on everything entering and leaving the shared layer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS CODE, NOT A PROMPT, AND THAT IS THE POINT.
 *
 * CLAUDE.md §7: guardrails run deterministically on generated output, after
 * generation. Prompt instructions are a first line, not the control. The thing
 * producing observations is a model reading a caterer's website — a document
 * written by a stranger, which is untrusted input by definition. "Do not include
 * prices" in a system prompt is a request. This file is the answer, and it runs
 * whether or not the prompt was followed, whether or not the prompt was seen,
 * and whether or not the caller is our own code.
 *
 * It also runs on the way *back in*. The sidecar is cross-tenant: every pattern
 * one tenant's extraction wrote is a pattern every other tenant reads. That
 * makes it a store we do not trust even though we own it, because trusting it
 * means one poisoned write becomes a figure in somebody else's quote. Reads are
 * scanned with exactly the same function as writes — one gate, both directions,
 * no second implementation to drift.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CANNOT DO, STATED PLAINLY, BECAUSE A FALSE CLAIM OF COMPLETENESS IS
 * WORSE THAN A STATED LIMIT.
 *
 * A denylist cannot be complete. Anyone who tells you their PII scanner catches
 * everything is describing a wish. The reason this design is nonetheless sound
 * is that **the denylist is not the primary defence** — the closed vocabulary in
 * `observation.ts` is. `read_as` and `corrected_to` cannot hold a price because
 * they cannot hold a string that is not one of sixteen enum members; that is a
 * wall, and this file is the net beneath it, guarding the one field that must
 * stay free-form (`locator`) and catching a caller who assembled an observation
 * without going through the parser.
 *
 * The named gaps are in `KNOWN_BLIND_SPOTS` below — exported, not buried in a
 * comment, so that anyone extending this layer meets the limits as data rather
 * than discovering them in production.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  type PatternObservation,
  type ShapeProblem,
  parseObservation,
} from './observation'

/**
 * Where a violation was found. `shape` covers a candidate that was not an
 * observation at all — the caller assembled an object by hand and got it wrong,
 * which is the same refusal from the store's point of view.
 */
export type ObservationField =
  | 'shape'
  | 'source_kind'
  | 'locator'
  | 'read_as'
  | 'corrected_to'
  | 'confidence_before'
  | 'language'

export type PurityRule =
  | 'malformed'
  /** €, $, EUR, CHF — a currency marker of any kind. */
  | 'currency_symbol'
  /** The word: Euro, Cent, Franken, dollar, pfund. Kills "achtzehn Euro" too. */
  | 'currency_word'
  /** `18,50` / `18.50` / `1.850,00` — digits either side of a separator. */
  | 'decimal_amount'
  /** A digit run long enough to be an amount, an id or a phone, never an index. */
  | 'long_digit_run'
  | 'email'
  | 'phone'
  /** Herr, Frau, Dr., Inhaber — or a `Vorname Nachname` shape. */
  | 'person_marker'
  /** A scheme, `www.`, or a hostname: a business identity. */
  | 'web_identity'
  /** GmbH, GbR, e.K. — a company, therefore a brand. */
  | 'legal_form'
  /** A selector that quotes content instead of addressing a position. */
  | 'quoted_literal'
  /** A character with no business in a structural locator. */
  | 'illegal_character'
  /** A digit outside a positional index. */
  | 'value_in_locator'
  /** Longer than any selector needs to be; a payload, not a path. */
  | 'oversized'
  | 'empty'

export interface PurityViolation {
  field: ObservationField
  rule: PurityRule
  /**
   * The offending text, truncated.
   *
   * Carried so the refusal is debuggable — "rejected" with no reason produces an
   * engineer who deletes the check. It is *evidence of a leak*, which means it
   * may contain the very price or name that was refused, so it goes back to the
   * caller on the tenant side of the boundary and is never written to the shared
   * layer, never logged cross-tenant, and never rendered to a customer. The
   * writer in `cognee.ts` drops it on the floor; only an owner-side surface or a
   * test ever reads it.
   */
  excerpt: string
  /** Plain language, because this is shown to whoever has to fix it. */
  reason: string
}

export type PurityVerdict =
  | { pure: true; observation: PatternObservation }
  | { pure: false; violations: PurityViolation[] }

/**
 * What this gate is known not to catch. Executable honesty.
 *
 * Each of these is a real hole. None of them is load-bearing, because the field
 * that could exploit it is enum-constrained — but if a future change opens a
 * free-text field in the shared layer, every line here becomes live and this
 * list is the specification of what would have to be built first.
 */
export const KNOWN_BLIND_SPOTS: readonly string[] = [
  'A number spelled out with no currency word: "achtzehnfünfzig", "eighteen fifty".',
  'A brand that is ordinary German words: "Zum Goldenen Hirschen", "Alte Mühle".',
  'A surname used bare and lowercase as a CSS class: ".mueller-menu" reads as structure.',
  'A price encoded as a short index-shaped integer inside brackets: "[1850]" is indistinguishable from a positional index.',
  'A first name alone, in any language: "Lisa" is a word.',
  'Any personal data expressed in a script other than Latin — non-ASCII is refused in locators, so this is a refusal rather than a leak, but it is not detection.',
]

/**
 * Where this gate deliberately over-refuses.
 *
 * Refusing a legitimate observation costs one lost training example. Admitting a
 * price costs the rule in EXECUTION_HANDOFF §4. The trade is not close, so every
 * ambiguous case is resolved towards refusal — and the cases are written down so
 * that a puzzled "why was my selector rejected" has an answer.
 */
export const KNOWN_OVER_REFUSALS: readonly string[] = [
  'A class name that collides with a TLD: "section.shop" reads as a hostname.',
  'A selector using :not() or :has() with an index inside it — put indices in brackets.',
  'A comma-separated selector list — record each branch as its own observation.',
]

/** Past this a selector is not a path, it is a payload. */
const MAX_LOCATOR_CHARS = 200
const EXCERPT_CHARS = 80

/* ────────────────────────── the text scanners ────────────────────────── */

const CURRENCY_SYMBOL = /[€$£¥₣]|\b(?:EUR|USD|GBP|CHF|eur|usd|gbp|chf)\b/
/**
 * Currency *words*, which is what makes "achtzehn Euro" fail without needing a
 * German number-word parser. No reading pattern ever needs to contain the word
 * Euro: "this position holds a per-person price" is already sayable, and is said
 * as the role `price_per_person`. So the word is banned outright, and the entire
 * spelled-out-amount class collapses into one rule.
 *
 * Absent on purpose: "Preis", "price", "Kosten". Those are labels, not amounts —
 * `.preisliste` is exactly the kind of layout knowledge this layer exists to
 * hold, and the role vocabulary itself contains "price".
 */
const CURRENCY_WORD = /\b(?:euro|euros|eur|cent|cents|franken|rappen|dollar|dollars|pfund|pence|sterling)\b/i
/** Digits either side of a separator: 18,50 · 18.50 · 1.850,00 */
const DECIMAL_AMOUNT = /\d\s?[.,]\s?\d/
/** Four or more digits together is an amount, an id or a phone — never an index. */
const LONG_DIGIT_RUN = /\d{4,}/
const EMAIL = /[^\s@]+@[^\s@]+\.[A-Za-z]{2,}|mailto:/i
const PHONE = /\+\d{1,3}[\s\-()/.]*\d{3,}|\b0\d{2,4}[\s\-/]\d{3,}|\btel:/i
const PERSON_MARKER =
  /\b(?:herr|frau|familie|fam|dr|prof|dipl|inh|inhaber|inhaberin|geschäftsführer|geschaeftsfuehrer|ansprechpartner|mr|mrs|ms)\b\.?/i
/** `Vorname Nachname`. Nothing structural is written as two capitalised words. */
const NAME_SHAPE = /\b[A-ZÄÖÜ][a-zäöüß]{1,}\s+[A-ZÄÖÜ][a-zäöüß]{1,}\b/
const WEB_SCHEME = /https?:\/\/|\bwww\.|\/\//i
const HOSTNAME = /\b[A-Za-z][A-Za-z0-9-]{3,}\.(?:de|at|ch|com|net|org|eu|io|shop|berlin|gmbh|catering|events)\b/i
/**
 * Two-letter forms (AG, KG, UG) are absent deliberately: they collide with real
 * words — `kg` is a portion unit a catering selector may legitimately name — and
 * a two-letter legal form with no company name attached identifies nobody.
 */
const LEGAL_FORM = /\b(?:gmbh|mbh|gbr|ohg|e\.k\.|e\.v\.|ltd|inc|llc)\b|&\s*co\b/i
const QUOTED_LITERAL = /["']/

interface Rule {
  rule: PurityRule
  pattern: RegExp
  reason: string
}

/**
 * Ordered so the most specific rule reports first. A string containing
 * `18,50 €` is caught by three of these; the caller should be told about the
 * currency symbol, not the decimal separator.
 */
const TEXT_RULES: readonly Rule[] = [
  {
    rule: 'currency_symbol',
    pattern: CURRENCY_SYMBOL,
    reason: 'carries a currency marker — a price belongs to one tenant and stays in their RLS boundary',
  },
  {
    rule: 'currency_word',
    pattern: CURRENCY_WORD,
    reason: 'names a currency — the shared layer records that a position holds a price, never the price',
  },
  {
    rule: 'email',
    pattern: EMAIL,
    reason: 'contains an email address — a person may not enter a cross-tenant store',
  },
  {
    rule: 'phone',
    pattern: PHONE,
    reason: 'contains a phone number — a person may not enter a cross-tenant store',
  },
  {
    rule: 'web_identity',
    pattern: WEB_SCHEME,
    reason: 'contains a URL — a hostname identifies the business it belongs to',
  },
  {
    rule: 'web_identity',
    pattern: HOSTNAME,
    reason: 'contains a hostname — a domain identifies the business it belongs to',
  },
  {
    rule: 'legal_form',
    pattern: LEGAL_FORM,
    reason: 'names a company — brands are tenant property and never shared',
  },
  {
    rule: 'person_marker',
    pattern: PERSON_MARKER,
    reason: 'addresses a person — a person may not enter a cross-tenant store',
  },
  {
    rule: 'person_marker',
    pattern: NAME_SHAPE,
    reason: 'reads as a personal name — nothing structural is written as two capitalised words',
  },
  {
    rule: 'decimal_amount',
    pattern: DECIMAL_AMOUNT,
    reason: 'contains a decimal amount — the shared layer holds no figures',
  },
  {
    rule: 'long_digit_run',
    pattern: LONG_DIGIT_RUN,
    reason: 'contains a long digit run — that is an amount, an identifier or a phone number, not a position',
  },
]

const truncate = (value: string): string =>
  value.length <= EXCERPT_CHARS ? value : `${value.slice(0, EXCERPT_CHARS)}…`

/**
 * Run every text rule over one field.
 *
 * Exported because the same scan guards the read path in `cognee.ts` and because
 * the invariant tests assert against it directly. All rules run — the first hit
 * does not stop the scan — so a caller fixing a rejected observation learns
 * everything wrong with it at once rather than in a sequence of round trips.
 */
export function scanText(field: ObservationField, value: string): PurityViolation[] {
  const violations: PurityViolation[] = []
  for (const { rule, pattern, reason } of TEXT_RULES) {
    const match = pattern.exec(value)
    if (match) {
      violations.push({ field, rule, excerpt: truncate(match[0]), reason })
    }
  }
  return violations
}

/**
 * Could a human read this string as an amount?
 *
 * Used by `shared-layer-no-numbers` to make its claim about what leaves this
 * layer, and deliberately *not* "does this contain a digit". `page[2]` contains
 * a digit and is a position; `18,50 €` and `ab 20 Pers.` are quantities. The
 * distinction is the whole difference between a reading pattern and a price.
 */
export function looksLikeQuantity(value: string): boolean {
  if (CURRENCY_SYMBOL.test(value) || CURRENCY_WORD.test(value)) return true
  if (DECIMAL_AMOUNT.test(value) || LONG_DIGIT_RUN.test(value)) return true
  // A digit next to a unit: "20 Pers.", "2,5 Std", "500g", "12 Stück".
  return /\d\s*(?:pers|person|personen|pax|gast|gäste|guests|stück|stk|portion|std|stunden|stunde|hours|hrs|min|kg|g|ml|l|%)\b/i.test(
    value,
  )
}

/* ────────────────────────── the locator grammar ────────────────────────── */

/**
 * Characters a structural locator may contain.
 *
 * An allowlist rather than a denylist, because this is the one field that must
 * stay free-form and it is therefore the one field where "we thought of every
 * bad character" is not a claim worth making. Note what is missing: `"` and `'`
 * (a selector that quotes content is a value field in disguise), `,` (which is
 * both a selector list and a German decimal separator — record each branch of
 * the list as its own observation), `@`, `&`, and every non-ASCII codepoint
 * except German umlauts, which also removes `€` and every Unicode digit and
 * homoglyph in one stroke.
 */
const LOCATOR_CHARSET = /^[A-Za-z0-9äöüßÄÖÜ_\-.#>+~:[\]()*=/ ]+$/

/** Bracket contents: an index, an attribute name, or an attribute set to a non-numeric value. */
const INDEX = /^\d{1,3}$/
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]*$/
const ATTRIBUTE_EQUALS = /^[A-Za-z][A-Za-z0-9_-]*=[A-Za-z][A-Za-z0-9_-]*$/

/**
 * Where a digit is allowed to survive outside brackets: heading levels and the
 * argument of an `nth-` pseudo-class. Both are positions in a document by
 * definition and neither can express an amount.
 */
const NTH_ARGUMENT = /:?nth-[a-z-]+\([^)]*\)/g
const HEADING_LEVEL = /\bh[1-6]\b/g
const BRACKET_GROUP = /\[([^\]]*)\]/g

/**
 * A locator may address a position. It may never quote a value.
 *
 * That one sentence is the entire grammar, and every rule below is a way of
 * holding it. The failure it prevents is specific and would otherwise be
 * invisible: `td:contains("18,50 €")` is a perfectly valid CSS-ish selector, it
 * looks structural at a glance, it would pass any reasonable "is this a
 * selector" check — and it is a price in a cross-tenant store. So content
 * quoting is refused outright, and digits are permitted only in the two shapes
 * that cannot mean money.
 */
export function checkLocator(locator: string): PurityViolation[] {
  const violations: PurityViolation[] = []
  const trimmed = locator.trim()

  if (trimmed.length === 0) {
    return [
      {
        field: 'locator',
        rule: 'empty',
        excerpt: '',
        reason: 'an observation with no locator records nothing — there is no position to learn about',
      },
    ]
  }

  if (locator.length > MAX_LOCATOR_CHARS) {
    violations.push({
      field: 'locator',
      rule: 'oversized',
      excerpt: truncate(locator),
      reason: `longer than ${MAX_LOCATOR_CHARS} characters — that is a payload, not a path`,
    })
  }

  // Content scan first, so the reported reason names the actual leak rather than
  // the character that happened to break the charset.
  violations.push(...scanText('locator', locator))

  if (QUOTED_LITERAL.test(locator)) {
    violations.push({
      field: 'locator',
      rule: 'quoted_literal',
      excerpt: truncate(locator),
      reason: 'quotes a literal — a locator addresses a position, it does not match content',
    })
  }

  if (!LOCATOR_CHARSET.test(trimmed)) {
    const illegal = [...trimmed].filter((character) => !LOCATOR_CHARSET.test(character))
    violations.push({
      field: 'locator',
      rule: 'illegal_character',
      excerpt: truncate([...new Set(illegal)].join('')),
      reason: 'contains characters with no structural meaning in a locator',
    })
  }

  // Brackets are checked before being removed, so `[data-price=1850]` cannot
  // hide a value in the one place digits are otherwise expected.
  for (const match of trimmed.matchAll(BRACKET_GROUP)) {
    const content = (match[1] ?? '').trim()
    const structural = INDEX.test(content) || IDENTIFIER.test(content) || ATTRIBUTE_EQUALS.test(content)
    if (!structural) {
      violations.push({
        field: 'locator',
        rule: 'value_in_locator',
        excerpt: truncate(match[0]),
        reason:
          'bracket holds neither an index nor an attribute name — an attribute value must start with a letter',
      })
    }
  }

  const withoutPositions = trimmed
    .replace(BRACKET_GROUP, '')
    .replace(NTH_ARGUMENT, '')
    .replace(HEADING_LEVEL, '')

  if (/\d/.test(withoutPositions)) {
    violations.push({
      field: 'locator',
      rule: 'value_in_locator',
      excerpt: truncate(withoutPositions),
      reason: 'holds a digit outside a positional index — indices belong in brackets',
    })
  }

  return violations
}

/* ────────────────────────── the gate ────────────────────────── */

const shapeReason = (problem: ShapeProblem): string => {
  switch (problem) {
    case 'not_an_object':
      return 'not an object'
    case 'unknown_source_kind':
      return 'source_kind is not one of the known source kinds'
    case 'locator_not_a_string':
      return 'locator is missing or not a string'
    case 'unknown_read_as':
      return 'read_as is not in the closed role vocabulary — free text may not enter the shared layer'
    case 'unknown_corrected_to':
      return 'corrected_to is not in the closed role vocabulary and is not null'
    case 'confidence_out_of_range':
      return 'confidence_before is not a number in [0, 1]'
    case 'unknown_language':
      return 'language is not one of the supported languages'
    case 'extra_field':
      return 'carries a field the shared-layer schema does not define'
  }
}

/**
 * The single gate. Everything written to or read from the shared layer goes
 * through here, and nothing else decides what is pure.
 *
 * Takes `unknown` on purpose. A signature of `PatternObservation` would be a
 * promise the compiler cannot keep at either boundary this guards: observations
 * come from a model's parsed output on one side and from a network response on
 * the other, and `as PatternObservation` is one keystroke. The check that runs
 * is the check that counts.
 */
export function checkObservationPurity(input: unknown): PurityVerdict {
  const shape = parseObservation(input)
  if (!shape.ok) {
    return {
      pure: false,
      violations: shape.problems.map((problem) => ({
        field: 'shape' as const,
        rule: 'malformed' as const,
        excerpt: '',
        reason: shapeReason(problem),
      })),
    }
  }

  const observation = shape.observation
  const violations = checkLocator(observation.locator)

  // The roles are already enum-checked above, so these scans can never fire
  // today. They are here because a scan that only runs where it is currently
  // needed is a scan that is missing the day the vocabulary is widened, and the
  // cost of two regex passes over a sixteen-member enum is nothing.
  violations.push(...scanText('read_as', observation.read_as))
  if (observation.corrected_to !== null) {
    violations.push(...scanText('corrected_to', observation.corrected_to))
  }

  if (violations.length > 0) return { pure: false, violations }
  return { pure: true, observation }
}

/** One line per violation, for an owner-side surface or a test failure message. */
export function explainViolations(violations: readonly PurityViolation[]): string {
  return violations.map((v) => `${v.field}: ${v.reason} (${v.rule}: "${v.excerpt}")`).join('; ')
}
