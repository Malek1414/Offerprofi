/**
 * The words on the guardrail form (F2.13, X5).
 *
 * Separate from the validation because this is the part that has to be *right* rather
 * than merely correct, and it is tested on its own (tests/onboarding/guardrail-form).
 *
 * Two rules hold throughout:
 *
 * 1. **Every label is a question about her business.** She is a wedding planner, not
 *    an engineer, and she has three minutes. "Ab welchem Betrag möchten Sie selbst
 *    draufschauen?" is answerable in seconds; "max_auto_quote_value" is not
 *    answerable at all.
 *
 * 2. **Nothing here may promise a refusal.** `minOrderValue` is refusal-shaped — it
 *    reads like a minimum order, and in most products it would be one. Here it never
 *    turns anyone away: an inquiry below it produces a quote *and* tells the owner.
 *    Invariant 1 makes the alternative impossible in code (there is no
 *    `declined_by_system` state), so the only remaining risk is an owner who *believes*
 *    it declines small jobs and configures her business around a behaviour that will
 *    not happen. The wording has to close that gap, and a test asserts it does.
 */

import type { Language } from '../domain/event-brief'

export interface CopyEntry {
  label: string
  help: string
}

export type GuardrailCopyKey =
  | 'autoSendEnabled'
  | 'maxAutoQuoteValue'
  | 'minOrderValue'
  | 'allowScopeReduction'
  | 'maxNegotiationRounds'
  | 'quoteValidityDays'
  | 'leadTimeMinDays'
  | 'capacityPerDay'
  | 'allowEmoji'

const DE: Record<GuardrailCopyKey, CopyEntry> = {
  autoSendEnabled: {
    label: 'Angebote automatisch verschicken',
    help:
      'Wenn aus: Sie sehen jedes Angebot vorher und geben es selbst frei. ' +
      'Wenn an: einfache Anfragen beantwortet der Assistent allein — alles andere ' +
      'kommt trotzdem zu Ihnen.',
  },
  maxAutoQuoteValue: {
    label: 'Ab welchem Betrag möchten Sie selbst draufschauen?',
    help:
      'Angebote über diesem Betrag gehen erst raus, wenn Sie sie freigegeben haben. ' +
      'Bei großen Aufträgen lohnt sich der kurze Blick.',
  },
  minOrderValue: {
    label: 'Ab welchem Betrag lohnt sich eine Anfrage für Sie?',
    // The Invariant 1 sentence. Says what happens, and says plainly what does not.
    help:
      'Liegt eine Anfrage darunter, bekommt die Kundin trotzdem ein Angebot — wir ' +
      'geben Ihnen zusätzlich Bescheid, damit Sie entscheiden können. Niemand wird ' +
      'automatisch weggeschickt. Leer lassen, wenn Sie das nicht brauchen.',
  },
  allowScopeReduction: {
    label: 'Bei knappem Budget einen kleineren Umfang anbieten',
    help:
      'Nennt jemand ein Budget, das nicht reicht, stellt der Assistent zusätzlich ' +
      'eine kleinere Variante aus Ihren Leistungen zusammen. Ihre Preise bleiben ' +
      'dabei unverändert — Rabatte gibt er nie.',
  },
  maxNegotiationRounds: {
    label: 'Wie oft darf nachgebessert werden?',
    help:
      'Nach so vielen Änderungswünschen übernehmen Sie das Gespräch. Vier ist für ' +
      'die meisten genau richtig.',
  },
  quoteValidityDays: {
    label: 'Wie lange gilt ein Angebot?',
    help: 'Danach läuft es ab. Die Kundin wird zwei Tage vorher erinnert.',
  },
  leadTimeMinDays: {
    label: 'Wie viel Vorlauf brauchen Sie mindestens?',
    help:
      'Bei kurzfristigeren Terminen fragt der Assistent nach und meldet sich bei ' +
      'Ihnen, statt selbst zuzusagen. 0 heißt: auch kurzfristig ist möglich.',
  },
  capacityPerDay: {
    label: 'Wie viele Veranstaltungen schaffen Sie an einem Tag?',
    help: 'Ist ein Tag voll, schlägt der Assistent Alternativen vor und sagt Ihnen Bescheid.',
  },
  allowEmoji: {
    label: 'Emojis in Nachrichten erlauben',
    help: 'Passend, wenn Sie selbst welche verwenden. Sonst besser aus.',
  },
}

const EN: Record<GuardrailCopyKey, CopyEntry> = {
  autoSendEnabled: {
    label: 'Send quotes automatically',
    help:
      'Off: you see and release every quote yourself. On: the assistant answers ' +
      'straightforward inquiries on its own — everything else still comes to you.',
  },
  maxAutoQuoteValue: {
    label: 'Above what amount do you want to look first?',
    help:
      'Quotes above this go out only once you have released them. On large jobs the ' +
      'quick look is worth it.',
  },
  minOrderValue: {
    label: 'From what amount is an inquiry worth your time?',
    help:
      'Below this the customer still receives a quote — we simply tell you as well, ' +
      'so you can decide. Nobody is ever turned away automatically. Leave empty if ' +
      'you do not need it.',
  },
  allowScopeReduction: {
    label: 'Offer a smaller scope when the budget is tight',
    help:
      'If someone names a budget that will not stretch, the assistant also puts ' +
      'together a smaller version from your own services. Your prices stay as they ' +
      'are — it never discounts.',
  },
  maxNegotiationRounds: {
    label: 'How many rounds of changes?',
    help: 'After this many change requests you take over the conversation. Four suits most.',
  },
  quoteValidityDays: {
    label: 'How long is a quote valid?',
    help: 'After that it expires. The customer is reminded two days beforehand.',
  },
  leadTimeMinDays: {
    label: 'How much notice do you need?',
    help:
      'For anything shorter the assistant asks and comes to you rather than ' +
      'committing. 0 means short notice is fine.',
  },
  capacityPerDay: {
    label: 'How many events can you handle in one day?',
    help: 'When a day is full the assistant suggests alternatives and lets you know.',
  },
  allowEmoji: {
    label: 'Allow emoji in messages',
    help: 'Fitting if you use them yourself. Otherwise better off.',
  },
}

export function guardrailCopy(language: Language): Record<GuardrailCopyKey, CopyEntry> {
  return language === 'de' ? DE : EN
}
