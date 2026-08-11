'use client'

/**
 * Confirming what was extracted — the screen the flywheel depends on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE VERDICT IS THE TRAINING SIGNAL, SO THIS SCREEN IS NOT ADMIN.
 *
 * §4: each confirm, edit and reject is a labelled example produced free by the
 * best-qualified labeller alive for that data. That makes owner engagement the
 * input to the product getting better, and it means a tedious version of this
 * screen does not merely annoy people — it stops the flywheel.
 *
 * Five properties carry it, and each one is answering a specific way owners quit:
 *
 *   1. **Confidence-sorted, and split.** Twenty-nine cards each demanding a tap
 *      when twenty-four were obviously right is how you lose someone in ninety
 *      seconds. The confident group is one row and one tap — collapsed, never
 *      hidden, because hiding what you are about to accept is not consent.
 *   2. **Evidence inline.** The source snippet sits under the candidate, so
 *      verification is a glance rather than an expedition into a PDF. An owner
 *      who has to go hunting will instead start pressing "passt" on everything,
 *      and the signal turns to noise without anyone noticing.
 *   3. **Partial state is valid.** Leave at item 3 of 29, come back tomorrow.
 *      Each verdict is committed on its own, so there is nothing to lose.
 *   4. **Time-boxed and stated up front.** "≈3 Minuten" — an unbounded queue is
 *      one nobody starts.
 *   5. **The bar moves.** It reads decided-of-total across all sessions, not this
 *      visit, because a bar that restarts at zero punishes coming back.
 *
 * Mobile swipes; desktop has J/K to move and Y/N to decide. Both exist because
 * this is the same screen on both — one codebase, not two apps.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import styles from './candidates.module.css'

interface SourceRef {
  assetId: string
  page?: number
  excerpt: string
}

export interface QueuedCandidate {
  id: string
  name: string
  description: string
  unit: string
  unitPriceCents: number
  vatRate: number | null
  quantityDriver: string
  confidence: number
  frequency: number
  quoteCount: number
  sourceRefs: SourceRef[]
}

export interface CandidateQueue {
  confident: QueuedCandidate[]
  needsYou: QueuedCandidate[]
  decided: number
  total: number
}

const euro = (cents: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100)

const DRIVER_LABEL: Record<string, string> = {
  flat: 'pauschal',
  per_guest: 'pro Person',
  per_hour: 'pro Stunde',
  per_km: 'pro km',
  per_day: 'pro Tag',
  per_item: 'pro Stück',
}

/**
 * Thirty seconds per uncertain item, rounded up to the nearest minute.
 *
 * Stated rather than estimated live, and deliberately not optimistic: an owner
 * who is told three minutes and spends five feels misled, where one told five and
 * finishing in three feels fast. The confident group costs one tap and is not
 * counted.
 */
function minutesFor(count: number): number {
  return Math.max(1, Math.ceil((count * 30) / 60))
}

export function CandidatesClient({ initial }: { initial: CandidateQueue }) {
  const [queue, setQueue] = useState(initial)
  const [index, setIndex] = useState(0)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState('')
  const liveRegion = useRef<HTMLParagraphElement>(null)

  const current = queue.needsYou[index]

  const post = useCallback(async (payload: Record<string, unknown>) => {
    const response = await fetch('/api/candidates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return (await response.json()) as Record<string, unknown>
  }, [])

  /**
   * Decide the current candidate and move on.
   *
   * The card advances immediately and the request settles behind it. This is the
   * one place optimism is clearly right: the owner is going through a queue at
   * speed, the server has no opinion that can change the outcome, and making him
   * wait a round trip per item is exactly the friction that ends the session
   * early. A failure puts the item back rather than swallowing it.
   */
  const decide = useCallback(
    async (verdict: 'confirm' | 'reject', edits: Record<string, unknown> = {}) => {
      if (!current || busy) return
      setBusy(true)
      setError('')

      const decided = current
      setIndex((n) => n + 1)
      setEditing(false)

      const body =
        verdict === 'confirm'
          ? { action: 'confirm', candidateId: decided.id, edits }
          : { action: 'reject', candidateId: decided.id, reason: '' }

      const result = await post(body).catch(() => ({ status: 'network_error' }))

      if (result.status === 'confirmed' || result.status === 'rejected' || result.status === 'already_decided') {
        setQueue((q) => ({ ...q, decided: q.decided + 1 }))
      } else {
        // Put it back. Silently dropping a verdict would lose a training example
        // and leave the owner believing he had dealt with it.
        setIndex((n) => Math.max(0, n - 1))
        setError('Das konnte nicht gespeichert werden. Bitte noch einmal.')
      }

      setBusy(false)
    },
    [busy, current, post],
  )

  const acceptAll = useCallback(async () => {
    if (queue.confident.length === 0 || busy) return
    setBusy(true)
    setError('')

    const ids = queue.confident.map((candidate) => candidate.id)
    const result = await post({ action: 'confirm_many', candidateIds: ids })

    if (typeof result.confirmed === 'number') {
      setQueue((q) => ({ ...q, confident: [], decided: q.decided + (result.confirmed as number) }))
    } else {
      setError('Das konnte nicht gespeichert werden. Bitte noch einmal.')
    }
    setBusy(false)
  }, [busy, post, queue.confident])

  /**
   * Desktop keys. J/K to move, Y/N to decide — the vim-adjacent pair, because
   * this screen is a queue and the people who go fastest through queues already
   * have those in their fingers.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Never while typing in the edit form: "n" would reject the item being
      // corrected, which is the most destructive possible misfire.
      if (editing) return
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return

      if (event.key === 'j') setIndex((n) => Math.min(n + 1, queue.needsYou.length))
      if (event.key === 'k') setIndex((n) => Math.max(n - 1, 0))
      if (event.key === 'y') void decide('confirm')
      if (event.key === 'n') void decide('reject')
      if (event.key === 'e') setEditing(true)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [decide, editing, queue.needsYou.length])

  // ─── Swipe, for the phone ─────────────────────────────────────────────────
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  function onTouchStart(event: React.TouchEvent) {
    const touch = event.touches[0]
    if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY }
  }

  function onTouchEnd(event: React.TouchEvent) {
    const start = touchStart.current
    const touch = event.changedTouches[0]
    if (!start || !touch) return
    touchStart.current = null

    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y

    // The vertical check is what stops a slightly-diagonal scroll from rejecting
    // an item. A swipe gesture that fires during scrolling is worse than no swipe
    // gesture, because it decides things the owner never looked at.
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return

    void decide(dx > 0 ? 'confirm' : 'reject')
  }

  const remaining = queue.needsYou.length - index
  const progress = queue.total > 0 ? Math.round((queue.decided / queue.total) * 100) : 0

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>Deine Leistungen bestätigen</h1>
        <p className={styles.sub}>
          {/* Property 4: stated up front, and honest. */}
          {remaining > 0
            ? `${remaining} brauchen dich · ungefähr ${minutesFor(remaining)} Minuten`
            : 'Alles erledigt.'}
        </p>

        {/* Property 5: decided of total, across every session. */}
        <div
          className={styles.bar}
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Fortschritt"
        >
          <span className={styles.barFill} style={{ width: `${progress}%` }} />
        </div>
        <p className={styles.barLabel}>
          {queue.decided} von {queue.total} entschieden
        </p>
      </header>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {/* ─── The confident group: one row, one tap ───────────────────────── */}
      {queue.confident.length > 0 ? (
        <section className={styles.bulk}>
          <button
            type="button"
            className={styles.bulkSummary}
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
          >
            <span>
              <strong>{queue.confident.length} Leistungen</strong> · sicher erkannt
            </span>
            <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
          </button>

          {/* Collapsed, never hidden. Accepting something the owner cannot see
              is not consent, so the list is always one tap from view. */}
          {expanded ? (
            <ul className={styles.bulkList}>
              {queue.confident.map((candidate) => (
                <li key={candidate.id}>
                  <span>{candidate.name}</span>
                  <span className={styles.bulkPrice}>{euro(candidate.unitPriceCents)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.bulkPreview}>
              {queue.confident.slice(0, 4).map((candidate) => candidate.name).join(' · ')}
              {queue.confident.length > 4 ? ' · …' : ''}
            </p>
          )}

          <button type="button" className={styles.primary} onClick={acceptAll} disabled={busy}>
            Alle {queue.confident.length} übernehmen
          </button>
        </section>
      ) : null}

      {/* ─── The ones that cost attention ────────────────────────────────── */}
      {current ? (
        <section
          className={styles.card}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          aria-live="polite"
        >
          <div className={styles.cardTop}>
            <span className={styles.eyebrow}>braucht dich</span>
            <span className={styles.counter}>
              {index + 1}/{queue.needsYou.length}
            </span>
          </div>

          <h2 className={styles.cardTitle}>{current.name}</h2>
          <p className={styles.cardPrice}>
            {euro(current.unitPriceCents)}{' '}
            <span className={styles.driver}>
              {DRIVER_LABEL[current.quantityDriver] ?? current.quantityDriver}
            </span>
          </p>

          {/* Property 2: the evidence, right here. */}
          {current.sourceRefs.length > 0 ? (
            <figure className={styles.evidence}>
              <figcaption className={styles.evidenceSource}>
                aus {current.sourceRefs[0]?.assetId}
                {current.sourceRefs[0]?.page ? `, S. ${current.sourceRefs[0]?.page}` : ''}
              </figcaption>
              <blockquote className={styles.excerpt}>{current.sourceRefs[0]?.excerpt}</blockquote>
            </figure>
          ) : (
            <p className={styles.noEvidence}>
              Für diese Leistung gibt es keinen Textbeleg — bitte besonders genau prüfen.
            </p>
          )}

          {editing ? (
            <EditForm
              candidate={current}
              busy={busy}
              onCancel={() => setEditing(false)}
              onSave={(edits) => decide('confirm', edits)}
            />
          ) : (
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.reject}
                onClick={() => decide('reject')}
                disabled={busy}
              >
                verwerfen
              </button>
              <button
                type="button"
                className={styles.edit}
                onClick={() => setEditing(true)}
                disabled={busy}
              >
                ändern
              </button>
              <button
                type="button"
                className={styles.accept}
                onClick={() => decide('confirm')}
                disabled={busy}
              >
                passt
              </button>
            </div>
          )}

          <p className={styles.hint}>
            <span className={styles.hintTouch}>Wischen: rechts übernehmen, links verwerfen</span>
            <span className={styles.hintKeys}>Tasten: J/K blättern · Y übernehmen · N verwerfen · E ändern</span>
          </p>
        </section>
      ) : queue.needsYou.length > 0 ? (
        <section className={styles.done}>
          <h2 className={styles.cardTitle}>Durch.</h2>
          <p className={styles.sub}>
            Du hast alles entschieden, was unsicher war. Deine Leistungen stehen jetzt im Katalog.
          </p>
        </section>
      ) : null}

      {queue.confident.length === 0 && queue.needsYou.length === 0 ? (
        <section className={styles.done}>
          <h2 className={styles.cardTitle}>Nichts offen</h2>
          <p className={styles.sub}>
            Sobald wir etwas Neues aus deinen Unterlagen oder deiner Website lesen, findest du es
            hier.
          </p>
        </section>
      ) : null}

      <p ref={liveRegion} className={styles.srOnly} aria-live="polite" />
    </div>
  )
}

/**
 * The edit form.
 *
 * Every field is editable, because extraction is a first draft and she knows her
 * own prices better than a model does. What she changes becomes `corrected_to` on
 * the verdict — which is the single most valuable row this product produces, and
 * the reason "ändern" is given equal weight with "passt" rather than being hidden
 * behind a pencil icon nobody presses.
 */
function EditForm({
  candidate,
  busy,
  onCancel,
  onSave,
}: {
  candidate: QueuedCandidate
  busy: boolean
  onCancel: () => void
  onSave: (_edits: Record<string, unknown>) => void
}) {
  const [name, setName] = useState(candidate.name)
  const [euros, setEuros] = useState((candidate.unitPriceCents / 100).toFixed(2).replace('.', ','))
  const [driver, setDriver] = useState(candidate.quantityDriver)

  function save() {
    const edits: Record<string, unknown> = {}
    if (name !== candidate.name) edits.name = name

    // German decimal comma, because that is what she types. Parsing it here
    // rather than forcing a point is the difference between a form that works on
    // a German phone keyboard and one that quietly reads 18,50 as 18.
    const cents = Math.round(Number(euros.replace(/\./g, '').replace(',', '.')) * 100)
    if (Number.isFinite(cents) && cents !== candidate.unitPriceCents) edits.unitPriceCents = cents

    if (driver !== candidate.quantityDriver) edits.quantityDriver = driver

    onSave(edits)
  }

  return (
    <div className={styles.form}>
      <label className={styles.field}>
        <span>Name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>

      <label className={styles.field}>
        <span>Preis</span>
        <input
          value={euros}
          onChange={(event) => setEuros(event.target.value)}
          inputMode="decimal"
          aria-describedby="preis-hilfe"
        />
      </label>
      <p id="preis-hilfe" className={styles.fieldHint}>
        Netto, in Euro. Komma als Dezimaltrennzeichen.
      </p>

      <label className={styles.field}>
        <span>Berechnung</span>
        <select value={driver} onChange={(event) => setDriver(event.target.value)}>
          {Object.entries(DRIVER_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.actions}>
        <button type="button" className={styles.reject} onClick={onCancel} disabled={busy}>
          zurück
        </button>
        <button type="button" className={styles.accept} onClick={save} disabled={busy}>
          übernehmen
        </button>
      </div>
    </div>
  )
}
