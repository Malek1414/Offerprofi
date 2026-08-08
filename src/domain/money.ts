/**
 * Money. EUR only in v1 (PRODUCT_SPEC §7.5).
 *
 * Everything is integer cents. Floating point never touches a price that reaches a
 * customer — `0.1 + 0.2 !== 0.3` is not an acceptable property of a quote engine.
 *
 * Rounding rule (spec §7.5): half-up to 2 decimals at line level, and totals are
 * summed from already-rounded lines. That ordering is deliberate — it matches German
 * accounting software, so an agency reconciling our quote against Lexware or sevdesk
 * gets the same number rather than a one-cent argument.
 */

/** Integer cents. Branded so a raw number cannot be passed where money is expected. */
export type Cents = number & { readonly __brand: 'Cents' }

/** A percentage, e.g. 19 for 19%. */
export type Percent = number

export const ZERO = 0 as Cents

export function cents(value: number): Cents {
  if (!Number.isInteger(value)) {
    throw new TypeError(`Cents must be an integer, got ${value}`)
  }
  if (!Number.isFinite(value)) {
    throw new TypeError(`Cents must be finite, got ${value}`)
  }
  return value as Cents
}

/** Parse a decimal euro amount ("1234.56") into cents. Used at the catalogue boundary. */
export function eurosToCents(euros: number | string): Cents {
  const n = typeof euros === 'string' ? Number(euros) : euros
  if (!Number.isFinite(n)) throw new TypeError(`Not a finite amount: ${euros}`)
  return cents(halfUp(n * 100))
}

export function centsToEuros(c: Cents): number {
  return c / 100
}

export function add(...values: Cents[]): Cents {
  return cents(values.reduce<number>((a, b) => a + b, 0))
}

export function subtract(a: Cents, b: Cents): Cents {
  return cents(a - b)
}

/**
 * Half-up rounding, symmetric around zero.
 *
 * `Math.round` is half-up only for positives (`Math.round(-0.5) === -0`), and we
 * do handle negative amounts — a scope-reduction variant subtracts lines. Doing this
 * by hand keeps the behaviour identical on both sides of zero.
 */
export function halfUp(value: number): number {
  if (!Number.isFinite(value)) throw new TypeError(`Cannot round ${value}`)
  return value < 0 ? -Math.round(-value) : Math.round(value)
}

/**
 * Multiply cents by a decimal quantity, rounding half-up to whole cents.
 * This is the line-subtotal operation of spec §7.3 step 4.
 */
export function multiplyByQuantity(unitPrice: Cents, quantity: number): Cents {
  if (!Number.isFinite(quantity)) throw new TypeError(`Bad quantity: ${quantity}`)
  if (quantity < 0) throw new RangeError(`Quantity may not be negative: ${quantity}`)
  return cents(halfUp(unitPrice * quantity))
}

/**
 * Apply a percentage adjustment, rounding half-up. `applyPercent(10000, 15)` is the
 * +15% peak-season modifier and returns the *delta* (1500), not the new total —
 * modifiers are recorded individually in the calculation trace (spec §7.3 step 5),
 * so the delta is the number we need to store.
 */
export function percentOf(amount: Cents, percent: Percent): Cents {
  if (!Number.isFinite(percent)) throw new TypeError(`Bad percent: ${percent}`)
  return cents(halfUp((amount * percent) / 100))
}

/** Format for display. Deliberately German-locale by default — this is a DACH product. */
export function formatCents(c: Cents, locale: 'de' | 'en' = 'de'): string {
  return new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-IE', {
    style: 'currency',
    currency: 'EUR',
  }).format(centsToEuros(c))
}
