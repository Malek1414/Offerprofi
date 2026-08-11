/**
 * `/onboarding/brand` while the brand profile loads (D1).
 *
 * The preview panel below the colour controls is the point of this screen, and it is
 * the tallest thing on it. Reserving its height stops the colour picker — the control
 * the owner reaches for first — from sliding as the preview appears underneath.
 */

import styles from './brand.module.css'

export default function BrandLoading() {
  return (
    <main className={styles.page} aria-busy="true" aria-label="Markenauftritt wird geladen">
      <div className={styles.shell}>
        <span className={styles.back}>← Einrichtung</span>
        <h1 className={styles.title}>Ihr Markenauftritt</h1>
        <p className={styles.lede}>
          <span className="skeleton-line" style={{ display: 'block', width: '100%' }} />
          <span className="skeleton-line" style={{ display: 'block', width: '65%', marginTop: '0.35rem' }} />
        </p>

        <div className={styles.editor}>
          <div>
            <span className="skeleton-line" style={{ display: 'block', width: '8rem' }} />
            <p className={styles.help}>
              <span className="skeleton-line" style={{ display: 'block', width: '90%' }} />
            </p>
          </div>
          <div className={styles.colorControl}>
            <span className="skeleton" style={{ display: 'block', width: '3rem', height: '2.75rem' }} />
            <span className="skeleton" style={{ display: 'block', width: '7.5rem', height: '2.75rem' }} />
          </div>
        </div>

        <div className={styles.preview}>
          <span className={styles.previewLabel}>Vorschau</span>
          <span
            className="skeleton-line"
            style={{ display: 'block', width: '14rem', maxWidth: '100%', height: '2rem', marginBottom: '1.25rem' }}
          />
          <span className="skeleton" style={{ display: 'block', width: '100%', height: '4.5rem', marginBottom: '1rem' }} />
          <span className="skeleton" style={{ display: 'block', width: '9rem', height: '2.75rem' }} />
        </div>
      </div>
    </main>
  )
}
