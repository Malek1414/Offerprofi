import type { Metadata } from 'next'
import Link from 'next/link'

import styles from './uploads.module.css'
import { UploadClient } from './upload-client'
import { requireUserId } from '../../../auth/current-user'
import { listKnowledgeDocuments } from '../../../knowledge/repository'
import { branding } from '../../../lib/branding'

export const metadata: Metadata = { title: 'Angebote hochladen' }

export default async function UploadsPage() {
  const userId = await requireUserId('/onboarding/uploads')
  const documents = await listKnowledgeDocuments(userId)
  const brand = branding()

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.back} href="/onboarding">← Einrichtung</Link>

        <h1 className={styles.title}>Ihre Angebotsbibliothek</h1>
        <p className={styles.lede}>
          Laden Sie frühere Angebote hoch. {brand.productName} liest den Text, zerlegt ihn in auffindbare
          Abschnitte und nutzt Ihre eigene Sprache als Kontext für neue Anfragen.
        </p>

        <aside className={styles.privacy}>
          <strong>Die Originaldatei wird nicht gespeichert.</strong> Sie wird in dieser Anfrage
          gelesen und danach verworfen. Gespeichert bleiben der Dateiname und der extrahierte Text.
          Bitte entfernen Sie nicht benötigte Kundendaten vor dem Upload.
        </aside>

        <UploadClient initialDocuments={documents} />

      </div>
    </main>
  )
}
