'use client'

/**
 * Uploading files — the caterer's side.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STATE MACHINE IS ON THE SCREEN, AND THAT IS THE FEATURE.
 *
 * B1's requirement is not that uploads never fail — a phone in a tunnel will drop
 * a connection however the code is written — it is that a failure is *recoverable
 * and visible*. Visible means the per-file state is rendered rather than hidden
 * behind a spinner that either finishes or does not:
 *
 *     queued → parsing → needs_mapping → imported
 *                     ↘ failed  (with a reason, in German, and a retry)
 *
 * A file that vanishes silently is the single fastest way to lose a caterer's
 * confidence in the product, because the next thing she does is upload it again,
 * and the time after that she stops trusting anything the screen tells her.
 *
 * The list is loaded from the server rather than held in this component, so a
 * reload — or a different device — shows the same truth. State that lives only in
 * a tab is not state.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { acceptAttribute } from '../../uploads/limits'
import { sourceFromFile, uploadFile, type UploadProgress } from '../../uploads/client'
import styles from './uploads.module.css'
import { VoiceRecorder } from './voice-recorder'

interface Job {
  id: string
  filename: string
  byteSize: number
  state: string
  chunksReceived: number
  chunkTotal: number
  failureReason: string | null
  retryable: boolean
  rowsImported: number
  updatedAt: string
}

const STATE_LABEL: Record<string, string> = {
  queued: 'wartet',
  uploading: 'wird übertragen',
  parsing: 'wird gelesen',
  needs_mapping: 'bereit — Spalten zuordnen',
  imported: 'übernommen',
  failed: 'fehlgeschlagen',
}

const megabytes = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`

export function UploadsClient({ initial }: { initial: Job[] }) {
  const [jobs, setJobs] = useState<Job[]>(initial)
  const [active, setActive] = useState<Record<string, UploadProgress>>({})
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    const response = await fetch('/api/uploads')
    if (!response.ok) return
    const body = (await response.json()) as { jobs?: Job[] }
    if (body.jobs) setJobs(body.jobs)
  }, [])

  /**
   * Poll only while something is in flight.
   *
   * Parsing happens server-side after the last chunk lands, so the row keeps
   * changing after this component has stopped sending anything — but polling a
   * settled list forever is a request every three seconds for as long as the tab
   * is open, on a phone, on someone's data plan.
   */
  const pending = jobs.some((job) => ['queued', 'uploading', 'parsing'].includes(job.state))

  useEffect(() => {
    if (!pending) return
    const timer = setInterval(() => void refresh(), 3000)
    return () => clearInterval(timer)
  }, [pending, refresh])

  const send = useCallback(
    async (files: File[]) => {
      setNotice('')

      for (const file of files) {
        const key = `${file.name}:${file.size}`

        const result = await uploadFile(sourceFromFile(file), {
          surface: 'client',
          onProgress: (progress) => setActive((current) => ({ ...current, [key]: progress })),
        })

        setActive((current) => {
          const next = { ...current }
          delete next[key]
          return next
        })

        if (!result.ok) {
          setNotice(result.reason)
        } else if (result.storedUnread) {
          // D5, said out loud. A caterer who thinks a voice note was understood
          // will stop typing the details that are actually in it.
          setNotice(
            'Sprachaufnahme gespeichert. Sie wird aufbewahrt, damit du sie anhören kannst — ' +
              'automatisch ausgewertet wird sie nicht.',
          )
        }

        await refresh()
      }
    },
    [refresh],
  )

  function onDrop(event: React.DragEvent) {
    event.preventDefault()
    setDragging(false)
    void send([...event.dataTransfer.files])
  }

  const inFlight = Object.values(active)

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>Unterlagen hochladen</h1>
        <p className={styles.sub}>
          Preislisten, Menüs, Angebote, Fotos. Wir lesen daraus deine Leistungen und Preise —
          bestätigen musst du sie danach selbst.
        </p>
      </header>

      {/* The drop zone is also a button. A div with a drag handler is unusable
          with a keyboard and invisible to a screen reader, and this is the only
          way into the feature. */}
      <div
        className={`${styles.drop} ${dragging ? styles.dropActive : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <p className={styles.dropText}>Dateien hierher ziehen</p>
        <button type="button" className={styles.primary} onClick={() => inputRef.current?.click()}>
          Dateien auswählen
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className={styles.hiddenInput}
          // A hint to the file picker, never the check. The rules live in
          // src/uploads/limits.ts and are enforced server-side.
          accept={acceptAttribute('client')}
          onChange={(event) => {
            void send([...(event.target.files ?? [])])
            event.target.value = ''
          }}
        />
        <p className={styles.dropHint}>PDF, Word, Excel, CSV, Bilder · bis 25 MB je Datei</p>
      </div>

      <VoiceRecorder onRecorded={(file) => void send([file])} />

      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}

      {inFlight.length > 0 ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Läuft gerade</h2>
          {inFlight.map((progress) => {
            const percent =
              progress.byteSize > 0
                ? Math.min(100, Math.round((progress.bytesSent / progress.byteSize) * 100))
                : 0
            return (
              <div key={progress.filename} className={styles.row}>
                <div className={styles.rowTop}>
                  <span className={styles.name}>{progress.filename}</span>
                  <span className={styles.pct}>{percent}%</span>
                </div>
                <div className={styles.bar}>
                  <span className={styles.barFill} style={{ width: `${percent}%` }} />
                </div>
                <p className={styles.rowNote}>
                  {progress.waitingMs > 0
                    ? `Verbindung unterbrochen — neuer Versuch (${progress.attempt})`
                    : progress.chunksResumed > 0
                      ? `Wird fortgesetzt — ${progress.chunksResumed} Teile waren schon da`
                      : STATE_LABEL[progress.phase] ?? progress.phase}
                </p>
              </div>
            )
          })}
        </section>
      ) : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Deine Dateien</h2>

        {jobs.length === 0 ? (
          <p className={styles.empty}>Noch nichts hochgeladen.</p>
        ) : (
          <ul className={styles.list}>
            {jobs.map((job) => (
              <li key={job.id} className={styles.job}>
                <div className={styles.rowTop}>
                  <span className={styles.name}>{job.filename}</span>
                  <span className={styles.size}>{megabytes(job.byteSize)}</span>
                </div>

                <p
                  className={`${styles.state} ${job.state === 'failed' ? styles.stateFailed : ''}`}
                >
                  {STATE_LABEL[job.state] ?? job.state}
                  {job.state === 'imported' && job.rowsImported > 0
                    ? ` · ${job.rowsImported} Einträge`
                    : ''}
                </p>

                {/* A failed file says why, in words she can act on, and never
                    disappears. */}
                {job.failureReason ? (
                  <p className={styles.reason}>{job.failureReason}</p>
                ) : null}

                {job.retryable ? (
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={async () => {
                      await fetch(`/api/uploads/${job.id}`, { method: 'POST' })
                      await refresh()
                    }}
                  >
                    Nochmal versuchen
                  </button>
                ) : null}

                {/* A permanent failure gets no retry button, because a button
                    that appears to work and changes nothing is worse than none. */}
                {job.state === 'failed' && !job.retryable ? (
                  <p className={styles.rowNote}>
                    Diese Datei muss neu hochgeladen werden.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
