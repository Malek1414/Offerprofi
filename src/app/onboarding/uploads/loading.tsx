/**
 * `/onboarding/uploads` while the indexed documents load (D1).
 *
 * The file picker and its submit button sit above the document list, so they do not
 * move when the list arrives — which is why the upload card is drawn at full height
 * and the list below it is the part that fills in. An owner who arrives intending to
 * add a fourth quote can start before the first three have finished loading.
 */

import styles from './uploads.module.css'

const DOCUMENTS = [0, 1, 2]

export default function UploadsLoading() {
  return (
    <main className={styles.page} aria-busy="true" aria-label="Dokumente werden geladen">
      <div className={styles.shell}>
        <span className={styles.back}>← Einrichtung</span>
        <h1 className={styles.title}>Vergangene Angebote</h1>
        <p className={styles.lede}>
          <span className="skeleton-line" style={{ display: 'block', width: '100%' }} />
          <span className="skeleton-line" style={{ display: 'block', width: '60%', marginTop: '0.35rem' }} />
        </p>

        <div className={styles.uploadCard}>
          <h2 className={styles.sectionTitle}>Vergangene Angebote</h2>
          <p className={styles.help}>
            <span className="skeleton-line" style={{ display: 'block', width: '85%' }} />
          </p>
          <div className={styles.form}>
            <span className="skeleton" style={{ display: 'block', width: '100%', height: '2.75rem' }} />
            <span className="skeleton" style={{ display: 'block', width: '12rem', maxWidth: '100%', height: '2.75rem' }} />
          </div>
        </div>

        <div className={styles.documents}>
          <h2 className={styles.sectionTitle}>Indexierte Dokumente</h2>
          <ul className={styles.list}>
            {DOCUMENTS.map((document) => (
              <li className={styles.document} key={document}>
                <div>
                  <span className="skeleton-line" style={{ display: 'block', width: '11rem', maxWidth: '100%' }} />
                  <span
                    className="skeleton-line"
                    style={{ display: 'block', width: '8rem', marginTop: '0.25rem' }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  )
}
