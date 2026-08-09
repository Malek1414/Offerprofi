'use client'

import type { CSSProperties } from 'react'
import { useState } from 'react'

import styles from './brand.module.css'
import { buildAgencyTheme, themeStyle } from '../../../lib/theme'

interface Props {
  agencyName: string
  initialColor: string
  confirmed: boolean
}

export function BrandClient({ agencyName, initialColor, confirmed }: Props) {
  const [color, setColor] = useState(initialColor)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(confirmed)
  const [error, setError] = useState<string | null>(null)
  const theme = buildAgencyTheme(color)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      const response = await fetch('/api/brand', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ colorPrimary: color }),
      })
      const result = (await response.json()) as Record<string, unknown>
      if (result.status === 'unauthenticated') {
        window.location.assign('/login?next=/onboarding/brand')
        return
      }
      if (result.status === 'saved') {
        setColor(String(result.colorPrimary))
        setSaved(true)
        window.location.assign('/onboarding')
        return
      }
      if (result.status === 'forbidden') {
        setError('Nur die Inhaberin oder der Inhaber kann den Markenauftritt ändern.')
        return
      }
      setError('Bitte wählen Sie eine gültige Farbe.')
    } catch {
      setError('Keine Verbindung. Bitte versuchen Sie es erneut.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <section className={styles.editor}>
        <div>
          <label className={styles.label} htmlFor="brand-color">Primärfarbe</label>
          <p className={styles.help}>
            Diese Farbe erscheint im Chat und auf den Anfrage-Dokumenten. Kontraste werden
            automatisch lesbar angepasst.
          </p>
        </div>
        <div className={styles.colorControl}>
          <input
            className={styles.colorPicker}
            id="brand-color"
            type="color"
            value={color}
            onChange={(event) => {
              setColor(event.target.value.toUpperCase())
              setSaved(false)
            }}
            aria-label="Primärfarbe auswählen"
          />
          <input
            className={styles.hex}
            value={color}
            onChange={(event) => {
              setColor(event.target.value)
              setSaved(false)
            }}
            inputMode="text"
            pattern="#[0-9A-Fa-f]{6}"
            maxLength={7}
            aria-label="Primärfarbe als Hex-Code"
          />
        </div>
      </section>

      <section
        className={styles.preview}
        style={themeStyle(theme) as CSSProperties}
        aria-label="Vorschau des Markenauftritts"
      >
        <span className={styles.previewLabel}>Vorschau</span>
        <div className={styles.wordmark}>{agencyName}</div>
        <p className={styles.previewBubble}>Guten Tag! Erzählen Sie mir kurz, was Sie planen.</p>
        <span className={styles.previewButton}>Anfrage senden</span>
      </section>

      <div className={styles.logoNote}>
        <strong>Wortmarke inklusive.</strong> Solange kein Logo hinterlegt ist, erscheint Ihr
        Firmenname sauber gesetzt. Ein Logo ist für den Start nicht erforderlich.
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}

      <div className={styles.actions}>
        <button className={styles.submit} type="submit" disabled={busy}>
          {busy ? 'Wird gespeichert …' : 'Markenauftritt bestätigen'}
        </button>
        <span className={styles.saved} aria-live="polite">{saved ? 'Bereits bestätigt.' : ''}</span>
      </div>
    </form>
  )
}
