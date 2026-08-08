/**
 * The instant acknowledgement (F1.9).
 *
 * Target: under 10s p95 (CLAUDE.md §8). Acceptance: "Ack fires before the
 * extraction worker is scheduled, not after."
 *
 * This is the product's first promise and the reason it wins deals. Customers ask
 * three to five agencies at once and the fastest credible reply usually takes it —
 * so the acknowledgement cannot wait on extraction, on a model round-trip, or on
 * anything that can be slow or fail. It is deterministic text, composed from data
 * we already have, sent before any work is scheduled.
 *
 * The ordering is enforced structurally: `acknowledgeInquiry` returns a plan whose
 * steps are in a fixed order, and the test asserts the ack precedes the extraction
 * job. A future refactor that "tidies up" by awaiting extraction first fails loudly
 * rather than quietly costing p95.
 */

import type { Formality, Language } from '../domain/event-brief'
import { type Disclosure, buildDisclosure } from '../domain/disclosure'

export interface AckParams {
  agencyName: string
  ownerName: string
  language: Language
  formality: Exclude<Formality, 'unknown'>
  privacyNoticeUrl: string
  /** The SLA the agency advertises ("within X hours"). Open question #8 in CLAUDE.md. */
  slaHours: number
  /** True when triage sent this to the owner's tray (F1.11). */
  routedToOwner: boolean
  /** True when the customer has already asked for a human (I5). */
  automationPaused: boolean
}

export interface AckPlan {
  /** In order. The first step is always the customer hearing back. */
  steps: AckStep[]
  disclosure: Disclosure
  ackText: string
}

export type AckStep =
  /** F1.8 — the AI disclosure, versioned and stored before it is shown. */
  | { kind: 'record_disclosure' }
  /** F1.9 — the customer hears back. Nothing slow may precede this. */
  | { kind: 'send_ack' }
  /** Only after the customer has been answered. */
  | { kind: 'schedule_extraction' }
  /** F1.11 — the owner is told, without the customer waiting on it. */
  | { kind: 'notify_owner'; reason: 'routed_to_tray' | 'human_requested' }

/**
 * Build the acknowledgement and the ordered plan around it.
 *
 * Pure: it composes text and returns steps. The caller executes them. Keeping the
 * ordering decision in a pure function is what makes "ack before extraction"
 * testable without standing up a queue.
 */
export function acknowledgeInquiry(params: AckParams): AckPlan {
  const disclosure = buildDisclosure({
    agencyName: params.agencyName,
    ownerName: params.ownerName,
    language: params.language,
    formality: params.formality,
    privacyNoticeUrl: params.privacyNoticeUrl,
  })

  const steps: AckStep[] = [{ kind: 'record_disclosure' }, { kind: 'send_ack' }]

  // Extraction is scheduled only when automation is going to run. A paused
  // conversation (I5) must not have a worker quietly preparing a quote behind the
  // customer's back after they asked for a person.
  if (!params.automationPaused) {
    steps.push({ kind: 'schedule_extraction' })
  }

  if (params.automationPaused) {
    steps.push({ kind: 'notify_owner', reason: 'human_requested' })
  } else if (params.routedToOwner) {
    steps.push({ kind: 'notify_owner', reason: 'routed_to_tray' })
  }

  return { steps, disclosure, ackText: ackText(params) }
}

/**
 * The acknowledgement copy.
 *
 * It states what happens next and by when, and it never promises a quote will be
 * automatic — the owner confirms (D9, I3), and the ack is the first place a
 * customer could be misled about that.
 */
function ackText(params: AckParams): string {
  const { slaHours, ownerName } = params

  if (params.language === 'de') {
    const du = params.formality === 'du'
    if (params.automationPaused) {
      return du
        ? `Alles klar — ich habe ${ownerName} Bescheid gegeben. Du hörst dich direkt mit ihr ab, ` +
            `in der Regel innerhalb von ${slaHours} Stunden.`
        : `Alles klar — ich habe ${ownerName} Bescheid gegeben. Sie meldet sich persönlich bei Ihnen, ` +
            `in der Regel innerhalb von ${slaHours} Stunden.`
    }
    if (params.routedToOwner) {
      return du
        ? `Danke dir! Deine Anfrage ist angekommen und liegt bei ${ownerName} auf dem Tisch. ` +
            `Du bekommst in der Regel innerhalb von ${slaHours} Stunden eine Rückmeldung.`
        : `Vielen Dank! Ihre Anfrage ist angekommen und liegt bei ${ownerName} auf dem Tisch. ` +
            `Sie erhalten in der Regel innerhalb von ${slaHours} Stunden eine Rückmeldung.`
    }
    return du
      ? `Danke dir! Deine Anfrage ist angekommen. Ich stelle dir gleich ein passendes Angebot ` +
          `zusammen — ${ownerName} schaut vor der Bestätigung persönlich drüber. Spätestens in ` +
          `${slaHours} Stunden hörst du von uns.`
      : `Vielen Dank! Ihre Anfrage ist angekommen. Ich stelle Ihnen gleich ein passendes Angebot ` +
          `zusammen — ${ownerName} schaut vor der Bestätigung persönlich drüber. Spätestens in ` +
          `${slaHours} Stunden hören Sie von uns.`
  }

  if (params.automationPaused) {
    return (
      `Got it — I've let ${ownerName} know. She'll come back to you personally, ` +
      `usually within ${slaHours} hours.`
    )
  }
  if (params.routedToOwner) {
    return (
      `Thank you! Your inquiry has arrived and is with ${ownerName}. ` +
      `You'll normally hear back within ${slaHours} hours.`
    )
  }
  return (
    `Thank you! Your inquiry has arrived. I'll put a quote together for you now — ` +
    `${ownerName} reviews it personally before anything is confirmed. You'll hear ` +
    `from us within ${slaHours} hours at the latest.`
  )
}

/** Index of a step kind in a plan, or -1. Used by the ordering test and by callers. */
export function stepIndex(plan: AckPlan, kind: AckStep['kind']): number {
  return plan.steps.findIndex((s) => s.kind === kind)
}
