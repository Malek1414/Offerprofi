/**
 * S15 — guardrails (F2.13).
 *
 * Loads whatever the agency already has, falling back to `defaultGuardrails` so the
 * form is complete the moment it opens. That is the whole three-minute strategy: the
 * budget is for the two or three settings she wants to change, not for twelve she has
 * to fill in.
 */

import type { Metadata } from 'next'
import Link from 'next/link'

import styles from './guardrails.module.css'
import { GuardrailFormClient, type GuardrailValues } from './guardrail-form-client'
import { requireUserId } from '../../../auth/current-user'
import { loadGuardrails } from '../../../onboarding/repository'
import { defaultGuardrails } from '../../../guardrails/config'
import { formatEuroInput } from '../../../onboarding/catalogue-form'
import { cents } from '../../../domain/money'

export const metadata: Metadata = {
  title: 'Grenzen festlegen',
}

export default async function GuardrailsPage() {
  const userId = await requireUserId('/onboarding/guardrails')
  const existing = await loadGuardrails(userId)
  const defaults = defaultGuardrails('')

  const initial: GuardrailValues = existing
    ? {
        // A zero minimum means "no minimum", and the field says `egal` when empty —
        // so it is rendered empty rather than as "0,00", which would read like a
        // deliberate setting.
        minOrderValue: Number(existing.min_order_value_cents)
          ? formatEuroInput(cents(Number(existing.min_order_value_cents)))
          : '',
        maxAutoQuoteValue: formatEuroInput(cents(Number(existing.max_auto_quote_value_cents))),
        allowScopeReduction: Boolean(existing.allow_scope_reduction),
        maxNegotiationRounds: String(existing.max_negotiation_rounds),
        quoteValidityDays: String(existing.quote_validity_days),
        autoSendEnabled: Boolean(existing.auto_send_enabled),
        leadTimeMinDays: String(existing.lead_time_min_days),
        capacityPerDay: String(existing.capacity_per_day),
        allowEmoji: Boolean(existing.allow_emoji),
      }
    : {
        minOrderValue: '',
        maxAutoQuoteValue: formatEuroInput(defaults.maxAutoQuoteValue),
        allowScopeReduction: defaults.allowScopeReduction,
        maxNegotiationRounds: String(defaults.maxNegotiationRounds),
        quoteValidityDays: String(defaults.quoteValidityDays),
        autoSendEnabled: defaults.autoSendEnabled,
        leadTimeMinDays: String(defaults.leadTimeMinDays),
        capacityPerDay: String(defaults.capacityPerDay),
        allowEmoji: defaults.allowEmoji,
      }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.back} href="/onboarding">
          ← Einrichtung
        </Link>

        <h1 className={styles.title}>Ihre Grenzen</h1>
          <p className={styles.lede}>
            Sie legen fest, welche Vorschläge der Assistent für Sie vorbereiten darf. Das Angebot
            an die Kundin geben weiterhin Sie frei.
          </p>

        {/* The sentence that buys the three minutes: it tells her she may skip. */}
        <p className={styles.reassure}>
          Alles ist schon sinnvoll voreingestellt. Sie können direkt speichern und später
          jederzeit nachschärfen.
        </p>

        <GuardrailFormClient initial={initial} duringOnboarding={!existing} />
      </div>
    </main>
  )
}
