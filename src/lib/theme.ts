/**
 * Agency theming (FEATURE_INVENTORY §15 design brief).
 *
 * The product's design system is a chassis that hosts someone else's brand. Lisa's
 * quote has to look like it came from Lisa, not from us — so the agency supplies the
 * logo and one brand colour, and everything else on the page stays achromatic.
 *
 * That creates a problem worth solving properly: the agency picks the colour, and
 * they will pick pale yellow, or neon pink, or a grey so close to our own ink that
 * buttons vanish. A wedding planner choosing her Instagram pink should not be able to
 * produce an illegible quote, and she will never read a contrast guideline.
 *
 * So we derive a working palette from one hex and enforce WCAG AA at the boundary.
 * The agency's colour is honoured wherever it can be, and adjusted only as far as
 * legibility requires — never replaced, because it is their brand and quietly
 * swapping it for something we prefer would be worse than the contrast problem.
 */

export interface AgencyTheme {
  /** The colour as supplied. Used for large fills where contrast is not at stake. */
  brand: string
  /** Guaranteed ≥ 4.5:1 on paper. Used for links and text-weight brand accents. */
  brandInk: string
  /** Guaranteed ≥ 4.5:1 against `brand` — what a button label is set in. */
  onBrand: string
  /** A faint wash of the brand, for panel backgrounds. Always near-paper. */
  brandWash: string
  /** Hairline in the brand hue, visible but never loud. */
  brandLine: string

  /** Dark-scheme counterparts. Derived against the dark ground, not the light one. */
  brandInkDark: string
  brandWashDark: string
  brandLineDark: string

  adjusted: boolean
}

interface Rgb {
  r: number
  g: number
  b: number
}

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m || !m[1]) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

function toHex({ r, g, b }: Rgb): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** WCAG relative luminance. sRGB → linear, then the standard coefficients. */
export function luminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  }
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 }
const BLACK: Rgb = { r: 0, g: 0, b: 0 }

/** Our two grounds. Both cool, so neither pushes the agency hue off-key. */
const PAPER: Rgb = { r: 252, g: 252, b: 253 }
const PAPER_DARK: Rgb = { r: 27, g: 30, b: 36 }

const AA_NORMAL = 4.5

/**
 * Darken toward black until the colour reads on paper.
 *
 * Steps in small increments and keeps the first passing value rather than jumping
 * straight to something safe — a pale gold brand ends up as a deep bronze that is
 * recognisably the same colour, instead of an arbitrary dark brown.
 */
function darkenUntilReadable(colour: Rgb, against: Rgb, target: number): { rgb: Rgb; adjusted: boolean } {
  if (contrastRatio(colour, against) >= target) return { rgb: colour, adjusted: false }
  for (let amount = 0.05; amount <= 1; amount += 0.05) {
    const candidate = mix(colour, BLACK, amount)
    if (contrastRatio(candidate, against) >= target) return { rgb: candidate, adjusted: true }
  }
  return { rgb: BLACK, adjusted: true }
}

/**
 * Lighten toward white until the colour reads on the dark ground.
 *
 * The mirror of darkenUntilReadable. A deep navy brand that reads beautifully on
 * paper disappears entirely on a dark background, so it has to travel the other way.
 */
function lightenUntilReadable(colour: Rgb, against: Rgb, target: number): { rgb: Rgb; adjusted: boolean } {
  if (contrastRatio(colour, against) >= target) return { rgb: colour, adjusted: false }
  for (let amount = 0.05; amount <= 1; amount += 0.05) {
    const candidate = mix(colour, WHITE, amount)
    if (contrastRatio(candidate, against) >= target) return { rgb: candidate, adjusted: true }
  }
  return { rgb: WHITE, adjusted: true }
}

export const DEFAULT_BRAND = '#3F4756'

/**
 * Build a usable theme from one agency colour.
 *
 * An unparseable or missing colour falls back to our own neutral rather than
 * throwing — a broken hex in a brand profile must never stop a quote rendering. The
 * customer is waiting; a slightly off-brand document beats a 500.
 */
export function buildAgencyTheme(brandHex: string | null | undefined): AgencyTheme {
  const parsed = parseHex(brandHex ?? '') ?? parseHex(DEFAULT_BRAND)!

  const ink = darkenUntilReadable(parsed, PAPER, AA_NORMAL)

  // If neither white nor black reads well enough on the supplied colour, the fill
  // itself is the problem — a pale pink button cannot carry a legible label at any
  // text colour. In that case the darkened variant becomes the fill, so the button
  // is legible either way and the hue survives.
  const whiteContrast = contrastRatio(parsed, WHITE)
  const blackContrast = contrastRatio(parsed, BLACK)
  const fill = Math.max(whiteContrast, blackContrast) >= AA_NORMAL ? parsed : ink.rgb

  // The dark scheme is not a nicety. Deriving a wash by mixing toward light paper
  // and then rendering it on a dark ground produces a pale panel carrying pale text,
  // which is precisely the illegible result this module exists to prevent. Both
  // schemes are derived here and resolved in CSS, because an inline style cannot
  // carry a media query.
  const inkDark = lightenUntilReadable(parsed, PAPER_DARK, AA_NORMAL)

  return {
    brand: toHex(fill),
    brandInk: toHex(ink.rgb),
    onBrand: toHex(contrastRatio(fill, WHITE) >= contrastRatio(fill, BLACK) ? WHITE : BLACK),
    brandWash: toHex(mix(parsed, PAPER, 0.94)),
    brandLine: toHex(mix(parsed, PAPER, 0.72)),

    brandInkDark: toHex(inkDark.rgb),
    brandWashDark: toHex(mix(parsed, PAPER_DARK, 0.9)),
    brandLineDark: toHex(mix(parsed, PAPER_DARK, 0.68)),

    adjusted: ink.adjusted || fill !== parsed,
  }
}

/**
 * Emit both schemes as inline custom properties.
 *
 * The `-l` / `-d` pair is resolved by a media query in the consuming stylesheet.
 * `light-dark()` would be tidier but needs `color-scheme` declared on an ancestor,
 * and this has to work inside an emailed PDF renderer too.
 */
export function themeStyle(theme: AgencyTheme): Record<string, string> {
  return {
    '--brand': theme.brand,
    '--on-brand': theme.onBrand,
    '--brand-ink-l': theme.brandInk,
    '--brand-wash-l': theme.brandWash,
    '--brand-line-l': theme.brandLine,
    '--brand-ink-d': theme.brandInkDark,
    '--brand-wash-d': theme.brandWashDark,
    '--brand-line-d': theme.brandLineDark,
  }
}
