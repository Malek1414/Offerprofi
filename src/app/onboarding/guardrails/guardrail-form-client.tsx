'use client'

/**
 * S15 — the guardrail form (F2.13).
 *
 * Grouped into three questions an owner actually has — what may go out without me,
 * what may the assistant agree to, when am I available — rather than into the twelve
 * fields the database has. Two of the twelve (`blackoutDates`, `peakSeasonRanges`)
 * are calendar work and belong with F4.11; one (`escalationNotify`) needs channels
 * that arrive in Phase 10. They keep their defaults, which is why this screen can be
 * finished in three minutes.
 */

import { useState } from 'react'

import styles from './guardrails.module.css'
import { guardrailCopy, type GuardrailCopyKey } from '../../../onboarding/guardrail-copy'
import type { GuardrailProblem } from '../../../onboarding/guardrail-form'

export interface GuardrailValues {
  minOrderValue: string
  maxAutoQuoteValue: string
  allowScopeReduction: boolean
  maxNegotiationRounds: string
  quoteValidityDays: string
  autoSendEnabled: boolean
  leadTimeMinDays: string
  capacityPerDay: string
  allowEmoji: boolean
}

const MESSAGES: Record<string, string> = {
  'minOrderValue.unparseable': 'Das konnten wir nicht als Betrag lesen. Zum Beispiel: 1.500,00',
  'minOrderValue.above_max_auto':
    'Dieser Betrag liegt über der Freigabe-Grenze. Dann käme jedes Angebot doppelt zu Ihnen.',
  'maxAutoQuoteValue.missing': 'Bitte geben Sie einen Betrag an.',
  'maxAutoQuoteValue.unparseable': 'Das konnten wir nicht als Betrag lesen. Zum Beispiel: 5.000,00',
  'maxAutoQuoteValue.zero':
    'Bei 0 € würde nichts mehr automatisch rausgehen. Schalten Sie dafür lieber ' +
    '„Angebote automatisch verschicken" aus.',
  'maxNegotiationRounds.out_of_range': 'Bitte eine Zahl zwischen 1 und 10.',
  'quoteValidityDays.out_of_range': 'Bitte eine Zahl zwischen 1 und 365.',
  'leadTimeMinDays.out_of_range': 'Bitte eine Zahl zwischen 0 und 365.',
  'capacityPerDay.out_of_range': 'Bitte eine Zahl zwischen 1 und 50.',
}

interface Props {
  initial: GuardrailValues
  /** True when this is onboarding rather than a later edit — changes where we go next. */
  duringOnboarding: boolean
}

export function GuardrailFormClient({ initial, duringOnboarding }: Props) {
  const [values, setValues] = useState({ ...initial, autoSendEnabled: false })
  const [problems, setProblems] = useState<GuardrailProblem[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const copy = guardrailCopy('de')

  const errorFor = (field: string): string | undefined => {
    const problem = problems.find((p) => p.field === field)
    return problem && MESSAGES[`${problem.field}.${problem.code}`]
  }

  const set = <K extends keyof GuardrailValues>(key: K, value: GuardrailValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }))
    setSaved(false)
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setProblems([])
    setFormError(null)

    try {
      const response = await fetch('/api/guardrails', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      })
      const result = await response.json()

      if (result.status === 'saved') {
        if (duringOnboarding) {
          window.location.assign('/onboarding')
          return
        }
        setSaved(true)
        return
      }
      if (result.status === 'invalid') {
        setProblems(result.problems ?? [])
        return
      }
      if (result.status === 'unauthenticated') {
        window.location.assign('/login?next=/onboarding/guardrails')
        return
      }
      if (result.status === 'forbidden') {
        setFormError('Diese Einstellungen kann nur die Inhaberin des Kontos ändern.')
        return
      }
      setFormError('Das konnte gerade nicht gespeichert werden. Bitte versuchen Sie es erneut.')
    } catch {
      setFormError('Keine Verbindung. Bitte prüfen Sie Ihr Netz und versuchen Sie es erneut.')
    } finally {
      setBusy(false)
    }
  }

  const money = (key: 'minOrderValue' | 'maxAutoQuoteValue') => (
    <Setting copyKey={key} copy={copy} error={errorFor(key)}>
      <span className={styles.suffix}>
        <input
          className={styles.money}
          value={values[key]}
          onChange={(e) => set(key, e.target.value)}
          inputMode="decimal"
          placeholder={key === 'minOrderValue' ? 'egal' : '5.000,00'}
          aria-invalid={Boolean(errorFor(key))}
          aria-label={copy[key].label}
        />
        €
      </span>
    </Setting>
  )

  const count = (
    key: 'maxNegotiationRounds' | 'quoteValidityDays' | 'leadTimeMinDays' | 'capacityPerDay',
    suffix: string,
  ) => (
    <Setting copyKey={key} copy={copy} error={errorFor(key)}>
      <span className={styles.suffix}>
        <input
          className={styles.number}
          value={values[key]}
          onChange={(e) => set(key, e.target.value)}
          inputMode="numeric"
          aria-invalid={Boolean(errorFor(key))}
          aria-label={copy[key].label}
        />
        {suffix}
      </span>
    </Setting>
  )

  /*
   * The label wraps the input rather than pointing at it with `htmlFor`, which is
   * what turns 22px of checkbox into a 44px target (D1) using nothing but HTML the
   * browser already knows how to route. The label carries no text of its own — the
   * question is `settingLabel`, beside it — so the input's `aria-label` remains the
   * accessible name and nothing is announced twice.
   */
  const toggle = (key: 'autoSendEnabled' | 'allowScopeReduction' | 'allowEmoji') => (
    <Setting copyKey={key} copy={copy}>
      <label className={styles.checkboxTap}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={values[key]}
          onChange={(e) => set(key, e.target.checked)}
          disabled={key === 'autoSendEnabled'}
          aria-label={copy[key].label}
        />
      </label>
    </Setting>
  )

  return (
    <form onSubmit={onSubmit} noValidate>
      {formError && (
        <p className={styles.formError} role="alert">
          {formError}
        </p>
      )}

      <section className={styles.group}>
          <h2 className={styles.groupTitle}>Was landet bei Ihnen zur Prüfung?</h2>
        <div className={styles.settings}>
          {toggle('autoSendEnabled')}
          {money('maxAutoQuoteValue')}
          {money('minOrderValue')}
        </div>
      </section>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>Wie weit darf der Assistent gehen?</h2>
        <div className={styles.settings}>
          {toggle('allowScopeReduction')}
          {count('maxNegotiationRounds', 'Runden')}
          {count('quoteValidityDays', 'Tage')}
          {toggle('allowEmoji')}
        </div>
      </section>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>Wann sind Sie verfügbar?</h2>
        <div className={styles.settings}>
          {count('leadTimeMinDays', 'Tage')}
          {count('capacityPerDay', 'pro Tag')}
        </div>
      </section>

      <div className={styles.actions}>
        <button className={styles.submit} type="submit" disabled={busy}>
          {duringOnboarding ? 'Speichern und weiter' : 'Speichern'}
        </button>
        <span className={styles.saved} role="status" aria-live="polite">
          {saved ? 'Gespeichert.' : ''}
        </span>
      </div>
    </form>
  )
}

function Setting({
  copyKey,
  copy,
  error,
  children,
}: {
  copyKey: GuardrailCopyKey
  copy: ReturnType<typeof guardrailCopy>
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className={styles.setting}>
      <span className={styles.settingLabel}>{copy[copyKey].label}</span>
      <div className={styles.control}>{children}</div>
      <p className={styles.settingHelp}>{copy[copyKey].help}</p>
      {error && <p className={styles.fieldError}>{error}</p>}
    </div>
  )
}
