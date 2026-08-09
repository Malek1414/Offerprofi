'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'

import styles from './uploads.module.css'
import type { KnowledgeDocumentSummary } from '../../../knowledge/repository'
import { REQUIRED_PAST_QUOTES } from '../../../onboarding/progress'

const PROBLEMS: Record<string, string> = {
  empty: 'Die Datei ist leer.',
  too_large: 'Die Datei ist größer als 25 MB.',
  unsupported_type: 'Bitte laden Sie eine PDF- oder TXT-Datei hoch.',
  invalid_text: 'Die Textdatei ist nicht als UTF-8 lesbar.',
  unreadable_pdf: 'Die PDF-Datei konnte nicht gelesen werden. Geschützte PDFs bitte zuerst entsperren.',
  no_text: 'In der Datei wurde kein Text gefunden. Scans benötigen vor dem Upload eine Texterkennung.',
  too_much_text: 'Das Dokument enthält zu viel Text für einen einzelnen Upload.',
  missing_file: 'Bitte wählen Sie mindestens eine Datei aus.',
  invalid_form: 'Der Upload konnte nicht gelesen werden.',
}

interface Props {
  initialDocuments: KnowledgeDocumentSummary[]
}

export function UploadClient({ initialDocuments }: Props) {
  const [documents, setDocuments] = useState(initialDocuments)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const uploaded = documents.length
  const remaining = Math.max(0, REQUIRED_PAST_QUOTES - uploaded)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const files = inputRef.current?.files
    if (!files?.length) {
      setError(PROBLEMS.missing_file ?? 'Bitte wählen Sie mindestens eine Datei aus.')
      return
    }

    setBusy(true)
    setError(null)
    setNotice(null)
    let newest = documents
    let withoutContext = 0
    let duplicates = 0

    try {
      for (const file of Array.from(files)) {
        const body = new FormData()
        body.set('file', file)
        const response = await fetch('/api/knowledge', { method: 'POST', body })
        const result = (await response.json()) as Record<string, unknown>

        if (result.status === 'unauthenticated') {
          window.location.assign('/login?next=/onboarding/uploads')
          return
        }
        if (result.status === 'forbidden') {
          throw new Error('Nur die Inhaberin oder der Inhaber kann Angebotswissen ändern.')
        }
        if (result.status === 'invalid') {
          const problem = String(result.problem ?? '')
          throw new Error(`${file.name}: ${PROBLEMS[problem] ?? 'Die Datei konnte nicht verarbeitet werden.'}`)
        }
        if (result.status !== 'ingested' && result.status !== 'duplicate') {
          throw new Error(`${file.name}: Der Upload ist gerade nicht verfügbar.`)
        }

        const document = result.document as KnowledgeDocumentSummary
        if (result.status === 'duplicate') duplicates += 1
        else if (!result.contextualised) withoutContext += 1

        newest = [document, ...newest.filter((item) => item.documentId !== document.documentId)]
        setDocuments(newest)
      }

      const parts = [`${files.length - duplicates} Datei${files.length - duplicates === 1 ? '' : 'en'} indexiert.`]
      if (duplicates) parts.push(`${duplicates} bereits vorhanden.`)
      if (withoutContext) {
        parts.push('Der Text ist durchsuchbar; die zusätzlichen KI-Kontexthinweise folgen mit eingerichtetem Modell.')
      }
      setNotice(parts.join(' '))
      if (inputRef.current) inputRef.current.value = ''
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Der Upload ist fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(document: KnowledgeDocumentSummary) {
    if (!window.confirm(`„${document.sourceName}“ aus dem Wissensbestand entfernen?`)) return
    setError(null)
    setNotice(null)

    try {
      const response = await fetch('/api/knowledge', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documentId: document.documentId }),
      })
      const result = (await response.json()) as Record<string, unknown>
      if (result.status === 'unauthenticated') {
        window.location.assign('/login?next=/onboarding/uploads')
        return
      }
      if (result.status !== 'deleted') throw new Error()
      setDocuments((current) => current.filter((item) => item.documentId !== document.documentId))
      setNotice('Dokument entfernt. Die ursprüngliche Datei war nicht gespeichert.')
    } catch {
      setError('Das Dokument konnte gerade nicht entfernt werden.')
    }
  }

  return (
    <>
      <section className={styles.uploadCard} aria-labelledby="upload-title">
        <div>
          <span className={styles.count}>{uploaded} / {REQUIRED_PAST_QUOTES}</span>
          <h2 className={styles.sectionTitle} id="upload-title">Vergangene Angebote</h2>
          <p className={styles.help}>
            {remaining > 0
              ? `Noch ${remaining} ${remaining === 1 ? 'Angebot' : 'Angebote'} für einen aussagekräftigen Start.`
              : 'Genug Material für den Start. Weitere Dokumente verbessern den Wissensbestand.'}
          </p>
        </div>

        <form className={styles.form} onSubmit={onSubmit}>
          <label className={styles.fileLabel} htmlFor="offer-files">PDF oder TXT auswählen</label>
          <input
            ref={inputRef}
            className={styles.fileInput}
            id="offer-files"
            name="file"
            type="file"
            accept=".pdf,.txt,application/pdf,text/plain"
            multiple
            disabled={busy}
          />
          <button className={styles.submit} type="submit" disabled={busy}>
            {busy ? 'Wird gelesen und indexiert …' : 'Angebote indexieren'}
          </button>
        </form>

        {error && <p className={styles.error} role="alert">{error}</p>}
        {notice && <p className={styles.notice} role="status">{notice}</p>}
      </section>

      <section className={styles.documents} aria-labelledby="documents-title">
        <h2 className={styles.sectionTitle} id="documents-title">Indexierte Dokumente</h2>
        {documents.length === 0 ? (
          <p className={styles.empty}>Noch keine Dokumente hochgeladen.</p>
        ) : (
          <ul className={styles.list}>
            {documents.map((document) => (
              <li className={styles.document} key={document.documentId}>
                <div>
                  <strong className={styles.filename}>{document.sourceName}</strong>
                  <span className={styles.meta}>
                    {document.chunkCount} {document.chunkCount === 1 ? 'Abschnitt' : 'Abschnitte'} ·{' '}
                    {new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(
                      new Date(document.ingestedAt),
                    )}
                  </span>
                </div>
                <button className={styles.remove} type="button" onClick={() => remove(document)}>
                  Entfernen
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {uploaded >= REQUIRED_PAST_QUOTES && (
        <div className={styles.next}>
          <p>Der Wissensbestand ist bereit. Jetzt legen Sie die Leistungen fest, mit denen gerechnet wird.</p>
          <Link href="/onboarding/catalogue">Weiter zu den Leistungen →</Link>
        </div>
      )}
    </>
  )
}
