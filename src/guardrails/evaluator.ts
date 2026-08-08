/**
 * The guardrail evaluator (PRODUCT_SPEC §5.2, decision D8).
 *
 * Runs deterministically on every outbound message and every quote version, *after*
 * generation. The system prompt telling the model "never discount" is a first line,
 * not the control — a model that has been talked into ignoring its instructions has
 * no idea it has been. This function does not care what the model was told.
 *
 * Outcome of a violation (spec §5.2): the message is not sent, the inquiry moves to
 * `escalated`, and the owner is notified with the customer's request and the reason.
 * The customer receives a neutral holding message and is **never told a rule was
 * hit** — they asked a reasonable question and deserve a human, not a policy lecture.
 *
 * Note the shape of the outcome type. There is no `reject` variant. The only two
 * results are "send it" and "a human takes over" (I1).
 */

import type { Cents } from '../domain/money'
import type { PricedQuote } from '../engine/pricing'
import type { Guardrails } from './config'

export type GuardrailRule =
  | 'price_not_from_catalogue'
  | 'below_floor_price'
  | 'discount_offered'
  | 'invented_service'
  | 'below_min_order_value'
  | 'above_max_auto_quote_value'
  | 'committed_to_unavailable_date'
  | 'accepted_customer_price_framing'
  | 'sent_after_opt_out'
  | 'negotiation_rounds_exceeded'
  | 'auto_send_disabled'
  | 'injection_suspected'

export interface GuardrailCheck {
  rule: GuardrailRule
  passed: boolean
  details?: Record<string, unknown>
}

/**
 * `escalate` is not a failure state. It is one of the product's two legitimate
 * outcomes, and for a €12k corporate enquiry it is the *correct* one.
 */
export type GuardrailOutcome =
  | { action: 'send'; checks: GuardrailCheck[] }
  | { action: 'escalate'; reason: GuardrailRule; checks: GuardrailCheck[]; ownerMessage: string }

export interface OutboundContext {
  guardrails: Guardrails
  quote?: PricedQuote
  /** Draft text about to go to the customer. */
  messageText?: string
  negotiationRound: number
  contactOptedOutAt: string | null
  availabilityCommitted: boolean
  injectionSuspected: boolean
  /** Totals the customer quoted at us ("the other agency said €3,000"). Never an input. */
  customerAssertedPrices: Cents[]
}

/** Phrases that indicate a discount is being offered. Matched on the generated text. */
const DISCOUNT_PATTERNS: RegExp[] = [
  /\brabatt\b/i,
  /\bnachlass\b/i,
  /\bskonto\b/i,
  /\bpreisnachlass\b/i,
  /\bsonderpreis\b/i,
  /\bdiscount(ed)?\b/i,
  /\bspecial price\b/i,
  /\breduced (?:price|rate)\b/i,
  /\b\d{1,2}\s?%\s?(?:off|günstiger|billiger|reduziert)\b/i,
  /\bentgegenkommen\b/i,
]

/** A currency amount appearing in generated prose. Every one must come from the engine. */
const PRICE_IN_TEXT = /(?:€|EUR)\s?(\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})?|\d+(?:[.,]\d{2})?)|(\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})?|\d+(?:[.,]\d{2})?)\s?(?:€|EUR)/gi

function parseGermanAmountToCents(raw: string): number | null {
  // "1.234,56" (de) and "1234.56" (en) both occur; the model mirrors the customer.
  const cleaned = raw.replace(/\s/g, '')
  const isGerman = /,\d{2}$/.test(cleaned)
  const normalised = isGerman
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned.replace(/,/g, '')
  const n = Number(normalised)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

/** Every figure the engine legitimately produced, in cents. */
function legitimateAmounts(quote: PricedQuote): Set<number> {
  const set = new Set<number>([quote.netTotal, quote.grossTotal])
  for (const line of quote.lines) {
    set.add(line.unitPrice)
    set.add(line.subtotal)
    set.add(line.net)
    set.add(line.gross)
  }
  for (const v of quote.vatBreakdown) {
    set.add(v.net)
    set.add(v.vat)
  }
  for (const m of quote.modifiers) set.add(m.delta)
  return set
}

export function evaluateOutbound(ctx: OutboundContext): GuardrailOutcome {
  const checks: GuardrailCheck[] = []
  const g = ctx.guardrails

  const fail = (rule: GuardrailRule, ownerMessage: string, details?: Record<string, unknown>): GuardrailOutcome => {
    checks.push({ rule, passed: false, ...(details ? { details } : {}) })
    return { action: 'escalate', reason: rule, checks, ownerMessage }
  }
  const pass = (rule: GuardrailRule, details?: Record<string, unknown>) => {
    checks.push({ rule, passed: true, ...(details ? { details } : {}) })
  }

  // Opt-out is absolute and comes first — nothing justifies a message after it.
  if (ctx.contactOptedOutAt) {
    return fail('sent_after_opt_out', 'Contact opted out; all outbound is blocked.', {
      optedOutAt: ctx.contactOptedOutAt,
    })
  }
  pass('sent_after_opt_out')

  if (ctx.injectionSuspected) {
    return fail(
      'injection_suspected',
      'The customer message appears to contain instructions aimed at the assistant. ' +
        'Nothing was sent. Please read the message and reply yourself.',
    )
  }
  pass('injection_suspected')

  if (ctx.negotiationRound > g.maxNegotiationRounds) {
    return fail(
      'negotiation_rounds_exceeded',
      `This conversation has run ${ctx.negotiationRound} rounds (limit ${g.maxNegotiationRounds}). ` +
        'It probably needs you rather than another revision.',
      { round: ctx.negotiationRound, limit: g.maxNegotiationRounds },
    )
  }
  pass('negotiation_rounds_exceeded')

  if (ctx.messageText) {
    for (const pattern of DISCOUNT_PATTERNS) {
      if (pattern.test(ctx.messageText)) {
        return fail(
          'discount_offered',
          'The drafted reply offers a discount, which the agent may never do. ' +
            'Nothing was sent.',
          { matched: pattern.source },
        )
      }
    }
    pass('discount_offered')
  }

  if (ctx.customerAssertedPrices.length > 0 && ctx.quote) {
    // The customer saying a competitor charges €3,000 is information about the
    // customer, not a pricing input. If our total has landed exactly on a number
    // they named, something upstream has taken their framing as instruction.
    const asserted = new Set<number>(ctx.customerAssertedPrices)
    if (asserted.has(ctx.quote.grossTotal) || asserted.has(ctx.quote.netTotal)) {
      return fail(
        'accepted_customer_price_framing',
        "The quoted total matches a price the customer named. The catalogue should have " +
          'produced this number independently — please check before anything goes out.',
        { grossTotal: ctx.quote.grossTotal },
      )
    }
  }
  pass('accepted_customer_price_framing')

  if (ctx.quote) {
    const q = ctx.quote

    if (q.unknownServiceIds.length > 0) {
      return fail(
        'invented_service',
        `The agent asked for ${q.unknownServiceIds.length} service(s) that are not in your ` +
          'catalogue. Nothing was sent — add them, or reply yourself.',
        { unknown: q.unknownServiceIds },
      )
    }
    pass('invented_service')

    const belowFloor = q.lines.filter((l) => l.unitPrice < l.floorPrice)
    if (belowFloor.length > 0) {
      return fail('below_floor_price', 'A line priced below its floor. Nothing was sent.', {
        lines: belowFloor.map((l) => ({ item: l.catalogItemId, unitPrice: l.unitPrice, floor: l.floorPrice })),
      })
    }
    pass('below_floor_price')

    if (ctx.messageText) {
      const legit = legitimateAmounts(q)
      const found: number[] = []
      for (const match of ctx.messageText.matchAll(PRICE_IN_TEXT)) {
        const raw = match[1] ?? match[2]
        if (!raw) continue
        const c = parseGermanAmountToCents(raw)
        // Small integers are usually guest counts or hours, not prices.
        if (c === null || c < 10_00) continue
        if (!legit.has(c)) found.push(c)
      }
      if (found.length > 0) {
        return fail(
          'price_not_from_catalogue',
          'The drafted reply contains a figure the pricing engine did not produce. ' +
            'Nothing was sent.',
          { amounts: found },
        )
      }
    }
    pass('price_not_from_catalogue')

    // Value bounds. Both escalate. Neither declines — that distinction is the whole
    // point of D23, and it is why `minOrderValue` no longer sends a polite refusal.
    if (q.grossTotal < g.minOrderValue) {
      return fail(
        'below_min_order_value',
        `This enquiry prices at ${q.grossTotal / 100} EUR, below your ${g.minOrderValue / 100} EUR ` +
          'minimum. Have a look — you may still want it.',
        { grossTotal: q.grossTotal, minOrderValue: g.minOrderValue },
      )
    }
    pass('below_min_order_value')

    if (q.grossTotal > g.maxAutoQuoteValue) {
      return fail(
        'above_max_auto_quote_value',
        `A quote of ${q.grossTotal / 100} EUR is above your ${g.maxAutoQuoteValue / 100} EUR ` +
          'auto-send limit. Review it and send when you are happy.',
        { grossTotal: q.grossTotal, maxAutoQuoteValue: g.maxAutoQuoteValue },
      )
    }
    pass('above_max_auto_quote_value')

    const unavailable =
      q.availability === 'hard_conflict' || q.availability === 'capacity_reached'
    if (unavailable && ctx.availabilityCommitted) {
      return fail(
        'committed_to_unavailable_date',
        `The reply commits to a date that is ${q.availability.replace('_', ' ')}. Nothing was sent.`,
        { availability: q.availability },
      )
    }
    pass('committed_to_unavailable_date')

    if (!g.autoSendEnabled) {
      return fail(
        'auto_send_disabled',
        'Auto-send is off for your account, so this quote is waiting for you.',
        { grossTotal: q.grossTotal },
      )
    }
    pass('auto_send_disabled')
  }

  return { action: 'send', checks }
}

/**
 * What the customer sees when a guardrail fires.
 *
 * Deliberately says nothing about rules, limits or thresholds. From the customer's
 * side this reads as attentive service, which is also what it is — a person is now
 * looking at their enquiry.
 */
export function holdingMessage(ownerName: string, language: 'de' | 'en', formality: 'du' | 'sie' | 'unknown'): string {
  if (language === 'de') {
    return formality === 'du'
      ? `Ich gebe das kurz an ${ownerName} weiter — du hörst in Kürze.`
      : `Ich gebe das kurz an ${ownerName} weiter — Sie hören in Kürze.`
  }
  return `Let me pass this to ${ownerName} — you'll hear back shortly.`
}
