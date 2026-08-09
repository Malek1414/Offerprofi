/**
 * The inquiry state machine (PRODUCT_SPEC §3.1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INVARIANT 1 LIVES HERE. Read before editing.
 *
 * There is no `declined_by_system` state, and there never will be. The system has
 * exactly two outcomes for any inquiry: an offer is produced, or a human takes over.
 * No code path lets software refuse, reject, decline, deprioritise or turn away a
 * customer — not for budget, date, capacity, region, or suspected spam.
 *
 * That is not a stylistic preference. GDPR Art. 22(1) applies only to decisions based
 * *solely* on automated processing that produce *legal or similarly significant*
 * effects. An automated refusal of service is the exact fact pattern the article was
 * written for. Adding a system-decline state would pull this product into scope, and
 * D22 requires that be structurally impossible rather than merely unlikely.
 *
 * If you are here because you want the system to say no to someone: route to
 * `escalated` instead. A human then decides, with the full record in front of them.
 * `tests/invariants/i1-no-automated-refusal.test.ts` will fail if you do otherwise.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const INQUIRY_STATES = [
  'new',
  'acknowledged',
  'extracting',
  'qualifying',
  /**
   * She pressed send and the caterer has it. Not `owner_handling` — he has not
   * picked it up yet, and the gap between those two is the whole SLA.
   */
  'sent_to_owner',
  'priced',
  'quote_sent',
  'negotiating',
  'escalated',
  'owner_handling',
  'accepted',
  'confirmed',
  'fulfilled',
  // Terminal states. Note what is absent.
  'declined_by_customer',
  'declined_by_owner',
  'expired',
  'spam',
  'archived',
] as const

export type InquiryState = (typeof INQUIRY_STATES)[number]

/**
 * Who caused a transition. Written to `audit_log` on every edge (X4).
 * `system` = a worker or timer. `agent` = the conversation model. `user:<id>` = a
 * real authenticated person. `customer` = the end customer, who has no account.
 */
export type Actor =
  | { kind: 'system'; detail?: string }
  | { kind: 'agent'; runId?: string }
  | { kind: 'user'; userId: string }
  | { kind: 'customer'; inquiryId: string }

export function formatActor(actor: Actor): string {
  switch (actor.kind) {
    case 'system':
      return actor.detail ? `system:${actor.detail}` : 'system'
    case 'agent':
      return 'agent'
    case 'user':
      return `user:${actor.userId}`
    case 'customer':
      return 'customer'
  }
}

/**
 * States that only a human may move an inquiry into.
 *
 * `declined_by_owner` is the single decline path in the product, and it is reachable
 * only by an authenticated agency user (I1). `confirmed` is where the contract forms
 * under D9, so it is reachable only by a human with authority (I4) — this is what
 * makes the process not "solely automated" for Art. 22 purposes.
 */
export const HUMAN_ONLY_STATES = ['confirmed', 'declined_by_owner'] as const
export type HumanOnlyState = (typeof HUMAN_ONLY_STATES)[number]

export function isHumanOnlyState(state: InquiryState): state is HumanOnlyState {
  return (HUMAN_ONLY_STATES as readonly string[]).includes(state)
}

/**
 * Legal transitions. Anything not listed is rejected at runtime, not just discouraged.
 */
const TRANSITIONS: Readonly<Record<InquiryState, readonly InquiryState[]>> = {
  new: ['acknowledged', 'escalated', 'spam', 'archived'],
  acknowledged: ['extracting', 'escalated', 'spam', 'archived'],
  extracting: ['qualifying', 'sent_to_owner', 'priced', 'escalated', 'archived'],
  qualifying: ['qualifying', 'sent_to_owner', 'priced', 'escalated', 'expired', 'archived'],
  sent_to_owner: [
    'owner_handling',
    'negotiating',
    'priced',
    'quote_sent',
    'escalated',
    'declined_by_customer',
    'expired',
    'archived',
  ],
  priced: ['quote_sent', 'escalated', 'archived'],
  quote_sent: [
    'negotiating',
    'accepted',
    'escalated',
    'declined_by_customer',
    'expired',
    'archived',
  ],
  negotiating: [
    'negotiating',
    'priced',
    'quote_sent',
    'accepted',
    'escalated',
    'declined_by_customer',
    'expired',
    'archived',
  ],
  // Escalation is always recoverable. A human can hand the conversation back.
  escalated: ['owner_handling', 'qualifying', 'negotiating', 'quote_sent', 'archived'],
  owner_handling: [
    'negotiating',
    'quote_sent',
    'accepted',
    'confirmed',
    'declined_by_owner',
    'declined_by_customer',
    'archived',
  ],
  accepted: ['confirmed', 'declined_by_owner', 'owner_handling', 'archived'],
  confirmed: ['fulfilled', 'archived'],
  fulfilled: ['archived'],
  declined_by_customer: ['archived'],
  declined_by_owner: ['archived'],
  expired: ['negotiating', 'archived'],
  spam: ['new', 'archived'], // recoverable: a misclassified inquiry must be rescuable
  archived: [],
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: InquiryState,
    readonly to: InquiryState,
  ) {
    super(`Illegal inquiry transition: ${from} → ${to}`)
    this.name = 'IllegalTransitionError'
  }
}

export class AutomatedRefusalError extends Error {
  constructor(
    readonly to: InquiryState,
    readonly actor: Actor,
  ) {
    super(
      `Invariant 1 violation: ${formatActor(actor)} attempted to move an inquiry to ` +
        `"${to}", which only an authenticated agency user may do. Route to "escalated" ` +
        `instead — the system may never refuse a customer. See PRODUCT_SPEC §12.6.`,
    )
    this.name = 'AutomatedRefusalError'
  }
}

export function canTransition(from: InquiryState, to: InquiryState): boolean {
  return (TRANSITIONS[from] ?? []).includes(to)
}

export function allowedTransitions(from: InquiryState): readonly InquiryState[] {
  return TRANSITIONS[from] ?? []
}

/**
 * The only sanctioned way to change an inquiry's state.
 *
 * Throws rather than returning a result, because a caller that ignores a returned
 * error would silently leave the inquiry in a stale state — and a stale inquiry is a
 * customer who never hears back. Loud failure is the safer default here.
 */
export function assertTransition(from: InquiryState, to: InquiryState, actor: Actor): void {
  if (!canTransition(from, to)) {
    throw new IllegalTransitionError(from, to)
  }
  // I1 + I4: decline and confirm are human decisions, always.
  if (isHumanOnlyState(to) && actor.kind !== 'user') {
    throw new AutomatedRefusalError(to, actor)
  }
}
