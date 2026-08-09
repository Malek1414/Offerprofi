'use client'

/**
 * S1 — signup (F0.6, F0.7).
 *
 * Acceptance: "A stranger can create an account unaided", and "slug collision is
 * handled with a suggestion, not an error page."
 *
 * Four fields, one screen, no wizard. The spec has a separate S3 "create agency"
 * screen, and it is folded in here on purpose: an agency with no owner and an owner
 * with no agency are both unusable states, so there is no moment worth splitting
 * them across. It also removes a step from the path that decides the ≥70%
 * unaided-completion target.
 *
 * The slug is shown as a live URL preview rather than as a field labelled "slug",
 * because "slug" is not a word Lisa knows and the thing she actually cares about is
 * what the link on her Instagram bio will say.
 */

import { useMemo, useState } from 'react'

import styles from '../auth.module.css'
import { slugify } from '../../../auth/slug'
import type { SignupProblem } from '../../../auth/signup'

interface Props {
  /** From config, so the `{DOMAIN}` placeholder resolves in one place (open q. #1). */
  chatDomain: string
}

type FieldName = 'email' | 'password' | 'ownerName' | 'agencyName' | 'slug'

const MESSAGES: Record<string, string> = {
  'email.missing': 'Bitte geben Sie Ihre E-Mail-Adresse ein.',
  'email.malformed': 'Das sieht nicht nach einer E-Mail-Adresse aus.',
  'email.too_long': 'Diese Adresse ist zu lang.',
  'password.too_short': 'Mindestens 10 Zeichen. Ein Satz ist einfacher zu merken als ein Wort.',
  'password.too_long': 'Höchstens 256 Zeichen.',
  'ownerName.missing': 'Bitte geben Sie Ihren Namen ein.',
  'ownerName.too_long': 'Dieser Name ist zu lang.',
  'agencyName.missing': 'Bitte geben Sie den Namen Ihres Unternehmens ein.',
  'agencyName.too_long': 'Dieser Name ist zu lang.',
  'slug.reserved': 'Diese Adresse ist reserviert. Bitte wählen Sie eine andere.',
  'slug.too_short': 'Diese Adresse ist zu kurz.',
  'slug.too_long': 'Diese Adresse ist zu lang.',
  'slug.malformed': 'Nur Kleinbuchstaben, Zahlen und Bindestriche.',
  'slug.underivable':
    'Aus diesem Namen lässt sich keine Web-Adresse bilden. Bitte geben Sie eine ein.',
}

export function SignupForm({ chatDomain }: Props) {
  const [agencyName, setAgencyName] = useState('')
  const [ownSlug, setOwnSlug] = useState<string | null>(null)
  const [problems, setProblems] = useState<SignupProblem[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  // The same function the server validates with, so the preview cannot promise a
  // slug the server will then reject.
  const derived = useMemo(() => slugify(agencyName), [agencyName])
  const slug = ownSlug ?? derived

  const errorFor = (field: FieldName): string | undefined => {
    const problem = problems.find((p) => p.field === field)
    return problem && MESSAGES[`${problem.field}.${problem.code}`]
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setProblems([])
    setFormError(null)
    setSuggestions([])

    const data = new FormData(event.currentTarget)
    const body = {
      email: String(data.get('email') ?? ''),
      password: String(data.get('password') ?? ''),
      ownerName: String(data.get('ownerName') ?? ''),
      agencyName: String(data.get('agencyName') ?? ''),
      slug: ownSlug ?? undefined,
    }

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await response.json()

      if (result.status === 'created') {
        // A full navigation, not a client-side push: the session cookie was just set
        // and every subsequent page is server-rendered against it.
        window.location.assign('/onboarding')
        return
      }
      if (result.status === 'slug_taken') {
        setSuggestions(result.suggestions ?? [])
        setProblems([{ field: 'slug', code: 'reserved' }])
        setFormError(null)
        return
      }
      if (result.status === 'email_taken') {
        setFormError(
          'Für diese Adresse gibt es bereits ein Konto. Möchten Sie sich stattdessen anmelden?',
        )
        return
      }
      if (result.status === 'invalid') {
        setProblems(result.problems ?? [])
        return
      }
      setFormError('Das hat gerade nicht geklappt. Bitte versuchen Sie es noch einmal.')
    } catch {
      setFormError('Keine Verbindung. Bitte prüfen Sie Ihr Netz und versuchen Sie es erneut.')
    } finally {
      setSubmitting(false)
    }
  }

  const slugProblem = problems.find((p) => p.field === 'slug')

  return (
    <form onSubmit={onSubmit} noValidate>
      {formError && (
        <p className={styles.formError} role="alert">
          {formError}
        </p>
      )}

      <label className={styles.field}>
        <span className={styles.label}>Ihr Name</span>
        <input
          className={styles.input}
          name="ownerName"
          autoComplete="name"
          required
          aria-invalid={Boolean(errorFor('ownerName'))}
        />
        {errorFor('ownerName') && <span className={styles.fieldError}>{errorFor('ownerName')}</span>}
      </label>

      <label className={styles.field}>
        <span className={styles.label}>
          Name Ihres Unternehmens
          <span className={styles.hint}>So, wie er auf Ihrem Angebot stehen soll.</span>
        </span>
        <input
          className={styles.input}
          name="agencyName"
          value={agencyName}
          onChange={(e) => setAgencyName(e.target.value)}
          autoComplete="organization"
          required
          aria-invalid={Boolean(errorFor('agencyName'))}
        />
        {errorFor('agencyName') && (
          <span className={styles.fieldError}>{errorFor('agencyName')}</span>
        )}

        {/* The URL preview. Appears as soon as there is something to show, so the
            owner sees the permanent, customer-visible consequence of the name she is
            typing — before it is on a business card. */}
        {slug && (
          <span className={`${styles.preview} ${ownSlug ? styles.previewOwn : ''}`}>
            {chatDomain}/a/{slug}
          </span>
        )}
      </label>

      {/* Only once the derived slug is unusable does the owner ever see the word
          "Adresse" as an editable field. Until then it is a preview she never has to
          think about. */}
      {(suggestions.length > 0 || slugProblem || ownSlug !== null) && (
        <label className={styles.field}>
          <span className={styles.label}>
            Ihre Web-Adresse
            <span className={styles.hint}>
              Unter diesem Link erreichen Kundinnen und Kunden Ihren Chat.
            </span>
          </span>
          <input
            className={styles.input}
            name="slugField"
            value={ownSlug ?? derived}
            onChange={(e) => setOwnSlug(slugify(e.target.value))}
            inputMode="url"
            aria-invalid={Boolean(slugProblem)}
          />
          {slugProblem && suggestions.length === 0 && (
            <span className={styles.fieldError}>
              {MESSAGES[`slug.${slugProblem.code}`] ?? 'Diese Adresse ist nicht möglich.'}
            </span>
          )}
        </label>
      )}

      {suggestions.length > 0 && (
        <div className={styles.suggestions}>
          <p className={styles.suggestionsLede}>
            <strong>{slug}</strong> ist schon vergeben. Diese sind frei:
          </p>
          <ul className={styles.suggestionList}>
            {suggestions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  className={styles.suggestion}
                  onClick={() => {
                    setOwnSlug(s)
                    setSuggestions([])
                    setProblems([])
                  }}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <label className={styles.field}>
        <span className={styles.label}>E-Mail-Adresse</span>
        <input
          className={styles.input}
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={Boolean(errorFor('email'))}
        />
        {errorFor('email') && <span className={styles.fieldError}>{errorFor('email')}</span>}
      </label>

      <label className={styles.field}>
        <span className={styles.label}>
          Passwort
          <span className={styles.hint}>Mindestens 10 Zeichen.</span>
        </span>
        <input
          className={styles.input}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={Boolean(errorFor('password'))}
        />
        {errorFor('password') && <span className={styles.fieldError}>{errorFor('password')}</span>}
      </label>

      <button className={styles.submit} type="submit" disabled={submitting}>
        {submitting ? 'Konto wird erstellt …' : 'Konto erstellen'}
      </button>
    </form>
  )
}
