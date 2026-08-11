/**
 * Noticing that a confirmed catalogue has gone stale (C4).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS WHAT KEEPS PRODUCING TRAINING SIGNAL AFTER WEEK ONE.
 *
 * Onboarding produces a burst of verdicts and then stops. If nothing else ever
 * asks the owner a question, §4's flywheel has exactly one turn in it — and the
 * shared layer stops learning the day the last agency finishes signing up.
 *
 * Brand identity is not static: prices move with inflation and with the owner's
 * own creative decisions. So a scheduled re-crawl diffs against what she
 * confirmed and produces three items and a sentence:
 *
 *     "Deine Website hat sich geändert — 3 Preise weichen ab."
 *
 * Thirty seconds. Emphatically **not** a re-onboarding: a drift card that dumps
 * the whole catalogue back into the confirmation queue is one the owner closes,
 * and then closes every week after that until she stops reading the emails.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** A catalogue line as the owner confirmed it. */
export interface ConfirmedItem {
  catalogItemId: string
  name: string
  unitPriceCents: number
  unit: string
}

/** The same line as a re-crawl read it today. */
export interface ObservedItem {
  name: string
  unitPriceCents: number | null
  unit: string | null
  sourceUrl: string
  excerpt: string
}

export interface DriftCard {
  catalogItemId: string
  field: 'unitPriceCents' | 'unit' | 'name'
  currentValue: string
  observedValue: string
  sourceUrl: string
  excerpt: string
}

/**
 * How many differences are worth interrupting somebody for.
 *
 * Three, and the cap is the feature rather than a limitation. A card listing
 * nineteen changes is a re-onboarding wearing a different hat; one listing three
 * is a thirty-second decision. When a crawl finds more than three, the largest
 * discrepancies are shown — a price that moved by €40 matters more than one that
 * moved by 50 cents, and an owner given the choice of which three to see would
 * choose the same way.
 */
export const MAX_CARDS = 3

/**
 * Matching an observed line to a confirmed one.
 *
 * Name equality after normalisation, and nothing cleverer. Fuzzy matching is
 * tempting here and is a trap: a false match produces a drift card claiming the
 * owner's price for *Fingerfood* changed when the website was talking about
 * *Fingerfood Deluxe*, and one card like that teaches her the feature is
 * unreliable. A missed match produces no card, which is merely a lost
 * opportunity.
 *
 * The asymmetry is the whole argument — silence costs a nudge, a wrong card
 * costs trust.
 */
function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    // Collapse the punctuation and spacing a website restyles without meaning to
    // change anything: "Fingerfood-Menü" and "Fingerfood Menü" are one item.
    .replace(/[\s\-–—_·,.]+/g, ' ')
    .trim()
}

/** How far apart two prices are, as a share of the confirmed one. */
function relativeGap(current: number, observed: number): number {
  if (current === 0) return observed === 0 ? 0 : 1
  return Math.abs(observed - current) / current
}

export interface DetectOptions {
  /**
   * Ignore differences below this share of the confirmed price.
   *
   * Default 1%. Not zero: a page that renders "18,50" one week and "18,5" the
   * next has not changed its price, and a card for that is noise that costs
   * exactly as much attention as a real one.
   */
  minimumRelativeChange?: number
  maxCards?: number
}

export function detectDrift(
  confirmed: readonly ConfirmedItem[],
  observed: readonly ObservedItem[],
  options: DetectOptions = {},
): DriftCard[] {
  const threshold = options.minimumRelativeChange ?? 0.01
  const limit = options.maxCards ?? MAX_CARDS

  const byName = new Map<string, ConfirmedItem>()
  for (const item of confirmed) byName.set(normaliseName(item.name), item)

  const cards: Array<DriftCard & { weight: number }> = []

  for (const seen of observed) {
    const match = byName.get(normaliseName(seen.name))
    if (!match) continue

    if (seen.unitPriceCents !== null && seen.unitPriceCents !== match.unitPriceCents) {
      const gap = relativeGap(match.unitPriceCents, seen.unitPriceCents)
      if (gap >= threshold) {
        cards.push({
          catalogItemId: match.catalogItemId,
          field: 'unitPriceCents',
          currentValue: String(match.unitPriceCents),
          observedValue: String(seen.unitPriceCents),
          sourceUrl: seen.sourceUrl,
          excerpt: seen.excerpt,
          // Ranked by how far the price moved, not by how big it is. A €40 swing
          // on a €50 item is a bigger deal than a €40 swing on a €4,000 one.
          weight: gap,
        })
      }
    }

    if (seen.unit && seen.unit !== match.unit) {
      cards.push({
        catalogItemId: match.catalogItemId,
        field: 'unit',
        currentValue: match.unit,
        observedValue: seen.unit,
        sourceUrl: seen.sourceUrl,
        excerpt: seen.excerpt,
        // A changed unit outranks almost any price change: "per person" becoming
        // "per item" silently multiplies or divides every quote using it.
        weight: 10,
      })
    }
  }

  return cards
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map(({ weight: _weight, ...card }) => card)
}

/**
 * The sentence on the card.
 *
 * Counts what was found, not what is shown — telling an owner about three
 * differences when the crawl found nine, without saying so, is the kind of small
 * dishonesty that is discovered later and colours everything else.
 */
export function driftHeadline(found: number, language: 'de' | 'en' = 'de'): string {
  if (found === 0) {
    return language === 'de' ? 'Deine Website stimmt mit deinem Katalog überein.' : 'Your website matches your catalogue.'
  }

  if (language === 'en') {
    return found === 1
      ? 'Your website has changed — 1 entry differs.'
      : `Your website has changed — ${found} entries differ.`
  }

  return found === 1
    ? 'Deine Website hat sich geändert — 1 Eintrag weicht ab.'
    : `Deine Website hat sich geändert — ${found} Einträge weichen ab.`
}

/**
 * When this tenant is next due a re-crawl.
 *
 * `intervalDays === 0` disables it, and returning `null` rather than a date far
 * in the future is deliberate: a scheduler that reads a date will eventually run
 * the job, and "never" expressed as the year 3000 is a bug waiting for someone to
 * change a comparison.
 */
export function nextRecrawlAt(lastCrawledAt: Date | null, intervalDays: number): Date | null {
  if (intervalDays <= 0) return null
  if (!lastCrawledAt) return new Date()
  return new Date(lastCrawledAt.getTime() + intervalDays * 86_400_000)
}
