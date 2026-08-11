'use client'

/**
 * Recording a voice note — the caterer's side only.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CAPTURED, STORED AND FLAGGED. NEVER TRANSCRIBED (D5).
 *
 * This is not a limitation waiting to be lifted quietly. A transcript would be
 * an input to extraction, and extraction feeds pricing — so a misheard "achtzig"
 * for "achtzehn" is a quote with the wrong guest count, produced confidently, in
 * a document sent to a customer. Until transcription is good enough to carry that
 * and is measured against a held-out set, the recording is something the owner
 * listens to, and the UI says so rather than letting her assume otherwise.
 *
 * The customer surface has no recorder at all — not a disabled one. That is the
 * explicit owner correction in D2, and `acceptedTypes('customer')` enforces it
 * server-side regardless of what any component renders.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useRef, useState } from 'react'

import styles from './uploads.module.css'

type Status = 'idle' | 'recording' | 'denied' | 'unsupported'

export function VoiceRecorder({ onRecorded }: { onRecorded: (_file: File) => void }) {
  const [status, setStatus] = useState<Status>('idle')
  const [seconds, setSeconds] = useState(0)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopTicking = () => {
    if (ticker.current) clearInterval(ticker.current)
    ticker.current = null
  }

  const start = useCallback(async () => {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices) {
      setStatus('unsupported')
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      // Denial is an ordinary answer, not an error. She may simply be somewhere
      // she does not want a microphone on, and the screen must not treat that as
      // a fault she has to resolve.
      setStatus('denied')
      return
    }

    chunks.current = []
    const media = new MediaRecorder(stream)
    recorder.current = media

    media.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data)
    }

    media.onstop = () => {
      // Releasing the tracks is what turns off the recording indicator in the
      // browser chrome. Leaving them open leaves a caterer looking at a live
      // microphone dot on her own phone, which is exactly the impression this
      // product cannot afford to give.
      stream.getTracks().forEach((track) => track.stop())
      stopTicking()

      const blob = new Blob(chunks.current, { type: media.mimeType || 'audio/webm' })
      const extension = media.mimeType?.includes('mp4') ? 'm4a' : 'webm'
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
      onRecorded(new File([blob], `sprachnotiz-${stamp}.${extension}`, { type: blob.type }))

      setStatus('idle')
      setSeconds(0)
    }

    media.start()
    setStatus('recording')
    setSeconds(0)
    ticker.current = setInterval(() => setSeconds((n) => n + 1), 1000)
  }, [onRecorded])

  const stop = useCallback(() => {
    recorder.current?.stop()
    recorder.current = null
  }, [])

  return (
    <section className={styles.voice}>
      <div>
        <h2 className={styles.sectionTitle}>Sprachnotiz</h2>
        <p className={styles.rowNote}>
          {/* Stated plainly, in the place where the expectation is set. */}
          Wird gespeichert, damit du sie anhören kannst — automatisch ausgewertet wird sie nicht.
        </p>
      </div>

      {status === 'recording' ? (
        <button type="button" className={styles.recording} onClick={stop}>
          <span className={styles.dot} aria-hidden="true" />
          Aufnahme beenden ({String(Math.floor(seconds / 60)).padStart(2, '0')}:
          {String(seconds % 60).padStart(2, '0')})
        </button>
      ) : (
        <button type="button" className={styles.secondary} onClick={start}>
          Aufnehmen
        </button>
      )}

      {status === 'denied' ? (
        <p className={styles.rowNote}>
          Kein Zugriff auf das Mikrofon. Du kannst die Berechtigung in den Einstellungen deines
          Browsers ändern — oder die Datei einfach hochladen.
        </p>
      ) : null}
      {status === 'unsupported' ? (
        <p className={styles.rowNote}>
          Dieser Browser kann nicht aufnehmen. Nimm mit deiner Sprachmemo-App auf und lade die
          Datei hoch.
        </p>
      ) : null}
    </section>
  )
}
