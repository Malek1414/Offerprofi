'use client'

/**
 * S2 — login (F0.6).
 *
 * Two fields and a button. The interesting decisions are all about what it does
 * *not* do:
 *
 *   - No client-side validation beyond `required`. Telling someone their email "looks
 *     wrong" before they submit is guesswork on a field they know better than we do,
 *     and on a login form it is guesswork about an address that already exists.
 *   - One message for every failure, matching the server exactly. If the copy here
 *     ever distinguished "no such account" from "wrong password", the server's
 *     careful indistinguishability would be undone in the UI.
 *   - The password field is never cleared on failure. Clearing it is the reflex, and
 *     it punishes a mistyped character by making the owner retype the whole thing on
 *     a phone keyboard.
 */

import { useState } from 'react'

import styles from '../auth.module.css'

interface Props {
  /** Where to land after signing in. Already validated server-side as path-relative. */
  next: string
}

export function LoginForm({ next }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    const data = new FormData(event.currentTarget)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: String(data.get('email') ?? ''),
          password: String(data.get('password') ?? ''),
        }),
      })
      const result = await response.json()

      if (result.status === 'ok') {
        window.location.assign(next)
        return
      }
      if (result.status === 'rate_limited') {
        const seconds = Number(result.retryAfterSeconds ?? 30)
        setError(
          `Zu viele Versuche. Bitte warten Sie ${seconds} Sekunden und versuchen Sie es erneut.`,
        )
        return
      }
      if (result.status === 'unavailable') {
        setError('Die Anmeldung ist gerade nicht erreichbar. Bitte versuchen Sie es später erneut.')
        return
      }
      // Deliberately the same for unknown address and wrong password.
      setError('E-Mail-Adresse oder Passwort stimmen nicht.')
    } catch {
      setError('Keine Verbindung. Bitte prüfen Sie Ihr Netz und versuchen Sie es erneut.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {error && (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      )}

      <label className={styles.field}>
        <span className={styles.label}>E-Mail-Adresse</span>
        <input
          className={styles.input}
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Passwort</span>
        <input
          className={styles.input}
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>

      <button className={styles.submit} type="submit" disabled={submitting}>
        {submitting ? 'Anmelden …' : 'Anmelden'}
      </button>
    </form>
  )
}
