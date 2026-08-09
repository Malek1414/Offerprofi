/**
 * Onboarding progress (F2.3, F2.12).
 *
 * Acceptance: "The owner always knows what is left."
 *
 * Measured against the Phase 2 exit criterion — a confirmed 5-item catalogue in under
 * 15 minutes, unaided — because a progress bar measuring anything else is a progress
 * bar that lies. The buyer is a solo wedding planner on a phone (CLAUDE.md §7), and
 * the target is ≥70% unaided completion. Someone who cannot tell what is left will
 * abandon at the first ambiguity.
 *
 * Every requirement therefore carries the *reason* it exists, not just its state.
 * F2.3 is explicit that the three-quote requirement must be "explained, not just
 * enforced": an owner blocked by a rule she does not understand assumes the product
 * is broken and leaves.
 */

export interface OnboardingState {
  /** D4 / F2.3 — at least three, and the requirement is explained where it bites. */
  pastQuotesUploaded: number
  /** Items the owner has actually confirmed. Candidates do not count. */
  confirmedItemCount: number
  /** Confirmed items that have at least one price rule (Staffel band). */
  itemsWithPriceRule: number
  brandConfirmed: boolean
  guardrailsSet: boolean
}

export const REQUIRED_PAST_QUOTES = 3
export const REQUIRED_CONFIRMED_ITEMS = 5

export type RequirementId =
  | 'past_quotes'
  | 'confirmed_items'
  | 'price_rules'
  | 'brand'
  | 'guardrails'

export interface Requirement {
  id: RequirementId
  met: boolean
  /**
   * True when this requirement cannot be acted on yet because another one is
   * outstanding — today only "a price for every service" before any service exists.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * This exists because of a bug that only showed up on screen. The rule used to be
   * that a target of zero is met, on the reasoning that an owner with no services has
   * no services missing a price. Arithmetically true, and badly wrong in front of a
   * person: a brand-new owner opened onboarding and was told she had already
   * completed a step she had not started, with the counter claiming "1 von 5" of
   * progress she had not made. On the first screen of a flow measured by unaided
   * completion, that is worse than showing nothing.
   *
   * So a blocked requirement is neither met nor outstanding. It counts toward
   * neither, and the UI shows it without an action, because there is nothing yet to
   * click.
   * ─────────────────────────────────────────────────────────────────────────
   */
  blocked: boolean
  /** Where the owner is now, against what is needed. Drives "3 of 5", not a %. */
  current: number
  target: number
  /** Reason code; the UI localises it. The engine emits no prose (see i18n). */
  reasonCode: RequirementId
}

export interface OnboardingProgress {
  complete: boolean
  requirements: Requirement[]
  /** Only what is outstanding, in the order it should be tackled. */
  remaining: Requirement[]
  /** 0–1, weighted by requirement, for a coarse indicator only. */
  ratio: number
}

export function onboardingProgress(state: OnboardingState): OnboardingProgress {
  // Ordered as the owner should tackle them: uploads first, because everything
  // downstream is extracted from them; guardrails last, because they are the only
  // step that makes sense once she can see her own catalogue.
  const requirements: Requirement[] = [
    requirement('past_quotes', state.pastQuotesUploaded, REQUIRED_PAST_QUOTES),
    requirement('confirmed_items', state.confirmedItemCount, REQUIRED_CONFIRMED_ITEMS),
    // Every confirmed item needs a price rule, so the target moves with the
    // catalogue rather than being a fixed number she can satisfy and then break.
    // Blocked until there is at least one service to price — see `blocked` above.
    requirement('price_rules', state.itemsWithPriceRule, state.confirmedItemCount, {
      blocked: state.confirmedItemCount === 0,
    }),
    requirement('brand', state.brandConfirmed ? 1 : 0, 1),
    requirement('guardrails', state.guardrailsSet ? 1 : 0, 1),
  ]

  const met = requirements.filter((r) => r.met).length
  return {
    complete: met === requirements.length,
    requirements,
    // Blocked requirements are outstanding — they are not done — so they belong here.
    // They simply cannot be acted on yet, which is the caller's cue to omit the
    // action rather than to hide the step.
    remaining: requirements.filter((r) => !r.met),
    ratio: Number((met / requirements.length).toFixed(2)),
  }
}

function requirement(
  id: RequirementId,
  current: number,
  target: number,
  options: { blocked?: boolean } = {},
): Requirement {
  const blocked = options.blocked ?? false
  return {
    id,
    // A blocked requirement is never met, however the arithmetic comes out. Zero of
    // zero is not an achievement.
    met: !blocked && current >= target,
    blocked,
    current,
    target,
    reasonCode: id,
  }
}

/**
 * Why each requirement exists, in the owner's language.
 *
 * F2.3 requires the three-quote rule to be *explained*. The others follow the same
 * principle: a blocked owner who understands the block will act on it, and one who
 * does not will assume the product is broken.
 */
export function requirementExplanation(
  id: RequirementId,
  language: 'de' | 'en',
): { title: string; why: string } {
  const de: Record<RequirementId, { title: string; why: string }> = {
    past_quotes: {
      title: 'Drei frühere Angebote hochladen',
      why:
        'Daraus lesen wir Ihre Leistungen und Preise aus. Mit weniger als drei ' +
        'Angeboten erkennen wir nicht, welche Preise bei Ihnen die Regel sind und ' +
        'welche die Ausnahme waren.',
    },
    confirmed_items: {
      title: 'Fünf Leistungen bestätigen',
      why:
        'Erst bestätigte Leistungen werden für Angebote verwendet. Nichts geht ' +
        'ungeprüft in Ihren Katalog.',
    },
    price_rules: {
      title: 'Preise je Leistung hinterlegen',
      why:
        'Ohne Preis kann eine Leistung nicht kalkuliert werden. Staffelpreise ' +
        '(z. B. ab 50 Personen) können Sie hier ebenfalls anlegen.',
    },
    brand: {
      title: 'Logo und Farbe bestätigen',
      why: 'Damit Ihr Angebot nach Ihnen aussieht und nicht nach uns.',
    },
    guardrails: {
      title: 'Grenzen festlegen',
      why:
        'Sie legen fest, wie weit der Assistent gehen darf — etwa den niedrigsten ' +
        'Preis, den er nennen darf. Alles außerhalb dieser Grenzen kommt zu Ihnen.',
    },
  }

  const en: Record<RequirementId, { title: string; why: string }> = {
    past_quotes: {
      title: 'Upload three past quotes',
      why:
        'We read your services and prices from them. With fewer than three we ' +
        "cannot tell which of your prices are the rule and which were one-offs.",
    },
    confirmed_items: {
      title: 'Confirm five services',
      why: 'Only confirmed services are used in quotes. Nothing enters your catalogue unchecked.',
    },
    price_rules: {
      title: 'Set a price for each service',
      why:
        'A service without a price cannot be calculated. You can also add tiered ' +
        'prices here (for example, from 50 guests upwards).',
    },
    brand: {
      title: 'Confirm your logo and colour',
      why: 'So the quote looks like it came from you, not from us.',
    },
    guardrails: {
      title: 'Set your limits',
      why:
        'You decide how far the assistant may go — the lowest price it may quote, ' +
        'for instance. Anything outside your limits comes to you.',
    },
  }

  return language === 'de' ? de[id] : en[id]
}
