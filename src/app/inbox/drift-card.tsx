'use client'

/**
 * The thirty-second nudge (C4).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RESTRAINT IS THE FEATURE.
 *
 * Three rows, two buttons each, and a sentence saying how many were found. That
 * is the entire surface, and every instinct to grow it is the instinct that turns
 * this into a re-onboarding — which is the thing C4 exists to avoid. An owner who
 * opens her inbox to a list of nineteen catalogue differences closes it, and
 * closes it again next Sunday, and by the third week she has learned that the
 * banner at the top of her inbox is something to scroll past.
 *
 * So: `detectDrift` caps at three before this component ever sees the data, the
 * headline is honest about the rest, and there is no "show all" link. If the
 * website really has drifted in nineteen places, the right answer is not a longer
 * card — it is that she rebuilt her site and should re-run onboarding.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Not optimistic. Accepting a card writes to the live catalogue and can be legitimately
 * refused — a website price below her own floor is a conflict only she can settle —
 * so a row that vanished on tap and came back with an error would be worse than a
 * row that waits half a second.
 */

import { useState } from 'react'

import styles from './drift-card.module.css'
import { driftHeadline } from '../../drift/detect'
import type { OpenDriftCard } from '../../drift/repository'

interface Props {
  cards: OpenDriftCard[]
  /** What the crawl found, which may be more than what is shown. */
  found: number
}

type RowState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'gone' }
  | { kind: 'below_floor'; floorCents: number; observedCents: number }
  | { kind: 'error' }

const euro = (cents: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100)

/** A card is about a price or a unit, and the two read differently to a human. */
function describe(card: OpenDriftCard): { label: string; from: string; to: string } {
  if (card.field === 'unitPriceCents') {
    return {
      label: 'Preis',
      from: euro(Number(card.currentValue)),
      to: euro(Number(card.observedValue)),
    }
  }
  return { label: 'Einheit', from: card.currentValue, to: card.observedValue }
}

export function DriftCards({ cards, found }: Props) {
  const [state, setState] = useState<Record<string, RowState>>({})

  const decide = async (card: OpenDriftCard, action: 'accept' | 'dismiss') => {
    setState((s) => ({ ...s, [card.id]: { kind: 'working' } }))

    try {
      const response = await fetch('/api/drift', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ driftId: card.id, action }),
      })

      if (response.ok) {
        setState((s) => ({ ...s, [card.id]: { kind: 'gone' } }))
        return
      }

      if (response.status === 409) {
        const body = (await response.json()) as { floorCents?: number; observedCents?: number }
        setState((s) => ({
          ...s,
          [card.id]: {
            kind: 'below_floor',
            floorCents: Number(body.floorCents ?? 0),
            observedCents: Number(body.observedCents ?? 0),
          },
        }))
        return
      }

      setState((s) => ({ ...s, [card.id]: { kind: 'error' } }))
    } catch {
      setState((s) => ({ ...s, [card.id]: { kind: 'error' } }))
    }
  }

  const remaining = cards.filter((card) => state[card.id]?.kind !== 'gone')
  if (remaining.length === 0) return null

  return (
    <section className={styles.card} aria-labelledby="drift-heading">
      <h2 className={styles.heading} id="drift-heading">
        {driftHeadline(found)}
      </h2>

      <ul className={styles.list}>
        {remaining.map((card) => {
          const row = state[card.id] ?? { kind: 'idle' }
          const { label, from, to } = describe(card)
          const busy = row.kind === 'working'

          return (
            <li className={styles.row} key={card.id}>
              <div className={styles.detail}>
                <span className={styles.item}>{card.itemName}</span>
                <span className={styles.change}>
                  {label} <span className={styles.was}>{from}</span>
                  <span aria-hidden="true"> → </span>
                  <span className={styles.srOnly}>wird zu</span>
                  <strong className={styles.now}>{to}</strong>
                </span>

                {/* The evidence travels with the card so she verifies by glance
                    rather than by opening her own website and hunting for it. */}
                {card.excerpt && (
                  <a
                    className={styles.evidence}
                    href={card.sourceUrl}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    „{card.excerpt}“
                  </a>
                )}

                {row.kind === 'below_floor' && (
                  <p className={styles.conflict} role="status">
                    Deine Website nennt {euro(row.observedCents)}, dein Mindestpreis für diese
                    Leistung ist {euro(row.floorCents)}. Beide Zahlen sind deine —{' '}
                    <a href="/onboarding/catalogue">im Katalog anpassen</a>.
                  </p>
                )}

                {row.kind === 'error' && (
                  <p className={styles.conflict} role="status">
                    Das hat gerade nicht geklappt. Bitte noch einmal versuchen.
                  </p>
                )}
              </div>

              <div className={styles.actions}>
                <button
                  className={styles.accept}
                  disabled={busy}
                  onClick={() => void decide(card, 'accept')}
                  type="button"
                >
                  Übernehmen
                </button>
                <button
                  className={styles.dismiss}
                  disabled={busy}
                  onClick={() => void decide(card, 'dismiss')}
                  type="button"
                >
                  Passt so
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
