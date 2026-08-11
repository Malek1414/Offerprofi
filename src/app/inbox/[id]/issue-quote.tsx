'use client'

/**
 * "Angebot erstellen & senden" — the owner's one action on an enquiry.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STAGES ARE REAL, NOT DECORATION.
 *
 * Pricing, checking and writing happen server-side in one request, so a progress
 * bar would be a lie about where the time goes. What this shows instead is the
 * three things that *did* happen, revealed as the request resolves, because the
 * owner is about to send a document to a customer and is entitled to see that it
 * was priced from his catalogue and checked before it went.
 *
 * It also does the work of the pitch: this is where "the agent priced it" stops
 * being a claim and becomes a visible sequence.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * There is no optimistic UI here, deliberately, and it is the one screen in the
 * product where that is right. Optimism is for actions that will almost certainly
 * succeed and are cheap to reconcile; this one can legitimately come back "held"
 * because a guardrail fired, and showing a sent quote that then un-sends is worse
 * than waiting two seconds.
 */

import { useState } from 'react'

import styles from '../inbox.module.css'

type Stage = 'idle' | 'working' | 'issued' | 'held' | 'blocked'

interface Issued {
  quoteNumber: string
  grossTotalCents: number
  validUntil: string
  path: string | null
}

const BLOCKED_COPY: Record<string, string> = {
  no_request:
    'Zu dieser Anfrage ist noch nichts strukturiert erfasst. Sobald Datum, Personenzahl und Leistungen bekannt sind, lässt sich ein Angebot rechnen.',
  no_catalogue:
    'Dein Katalog ist noch leer. Trage zuerst deine Leistungen und Preise ein — daraus wird das Angebot gerechnet.',
  no_match:
    'Keine deiner Katalogleistungen passt zu dieser Anfrage. Ergänze die passende Leistung oder antworte selbst.',
  unavailable: 'Die Preisberechnung ist gerade nicht erreichbar. Bitte versuch es gleich noch einmal.',
}

const euro = (totalCents: number): string =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(totalCents / 100)

export function IssueQuote({ inquiryId }: { inquiryId: string }) {
  const [stage, setStage] = useState<Stage>('idle')
  const [issued, setIssued] = useState<Issued | null>(null)
  const [message, setMessage] = useState('')
  const [copied, setCopied] = useState(false)

  async function issue() {
    setStage('working')
    setMessage('')

    try {
      const response = await fetch(`/api/inquiries/${inquiryId}/quote`, { method: 'POST' })
      const body = (await response.json()) as Record<string, unknown>

      if (body.status === 'issued' || body.status === 'already_issued') {
        setIssued({
          quoteNumber: String(body.quoteNumber ?? ''),
          grossTotalCents: Number(body.grossTotalCents ?? 0),
          validUntil: String(body.validUntil ?? ''),
          path: typeof body.path === 'string' ? body.path : null,
        })
        setStage('issued')
        return
      }

      if (body.status === 'held') {
        // A guardrail fired. This is the product working — one of its two
        // legitimate outcomes — so it is reported as a decision that needs him,
        // never as an error.
        setMessage(String(body.message ?? ''))
        setStage('held')
        return
      }

      const reason = String(body.reason ?? 'unavailable')
      setMessage(BLOCKED_COPY[reason] ?? BLOCKED_COPY.unavailable ?? '')
      setStage('blocked')
    } catch {
      setMessage(BLOCKED_COPY.unavailable ?? '')
      setStage('blocked')
    }
  }

  async function replaceLink() {
    const response = await fetch(`/api/inquiries/${inquiryId}/quote`, { method: 'PUT' })
    const body = (await response.json()) as Record<string, unknown>
    if (body.status === 'replaced') {
      setIssued((previous) =>
        previous ? { ...previous, path: String(body.path ?? '') } : previous,
      )
      setCopied(false)
    }
  }

  async function copyLink(path: string) {
    await navigator.clipboard.writeText(new URL(path, window.location.origin).toString())
    setCopied(true)
  }

  if (stage === 'issued' && issued) {
    return (
      <section className={styles.panel} aria-live="polite">
        <h2 className={styles.panelTitle}>Angebot {issued.quoteNumber}</h2>
        <p className={styles.issuedTotal}>{euro(issued.grossTotalCents)}</p>
        <p className={styles.note}>
          Gültig bis {issued.validUntil}. Freibleibend — verbindlich wird es erst mit deiner
          Bestätigung.
        </p>

        {issued.path ? (
          <div className={styles.linkRow}>
            <a className={styles.primaryAction} href={issued.path} target="_blank" rel="noreferrer">
              Angebot ansehen
            </a>
            <button type="button" className={styles.secondaryAction} onClick={() => copyLink(issued.path!)}>
              {copied ? 'Link kopiert' : 'Link kopieren'}
            </button>
          </div>
        ) : (
          <>
            <p className={styles.note}>
              Dieses Angebot wurde bereits erstellt. Der Link wird aus Sicherheitsgründen nicht
              gespeichert und lässt sich nicht erneut anzeigen.
            </p>
            <button type="button" className={styles.secondaryAction} onClick={replaceLink}>
              Neuen Link erzeugen — der bisherige wird ungültig
            </button>
          </>
        )}
      </section>
    )
  }

  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>Angebot</h2>

      {stage === 'held' ? (
        <p className={styles.held} role="status">
          {message}
        </p>
      ) : null}
      {stage === 'blocked' ? (
        <p className={styles.blocked} role="status">
          {message}
        </p>
      ) : null}

      <button
        type="button"
        className={styles.primaryAction}
        onClick={issue}
        disabled={stage === 'working'}
      >
        {stage === 'working' ? 'Wird gerechnet…' : 'Angebot erstellen & senden'}
      </button>

      <p className={styles.note}>
        {/* Said out loud because it is the product's actual claim, and because a
            caterer pressing this for the first time deserves to know that the
            numbers come from his own price list and not from a model. */}
        Gerechnet aus deinem Katalog, geprüft gegen deine Leitplanken. Nichts wird ohne dich
        verbindlich.
      </p>
    </section>
  )
}
