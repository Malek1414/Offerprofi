/**
 * `/inbox/{id}` while the enquiry loads (D1).
 *
 * Reached by tapping a row on the list, which means the owner has already committed
 * to this screen and is watching for it. The panels are reserved at their real
 * heights so the "Angebot erstellen & senden" button — the one action on the page,
 * and the one thing he came here to press — is in the same place before and after the
 * data arrives. A button that slides down as content loads above it is how a person
 * ends up pressing something they did not mean to.
 *
 * Same module as the real page, so the boxes are the boxes.
 */

import styles from '../inbox.module.css'

const CONTACT_ROWS = [0, 1]
const REQUEST_ROWS = [0, 1, 2, 3]

export default function InquiryLoading() {
  return (
    <main className={styles.page} aria-busy="true" aria-label="Anfrage wird geladen">
      <div className={styles.shell}>
        <span className={styles.back}>← Alle Anfragen</span>

        <header className={styles.header}>
          <div>
            <span className="skeleton-line" style={{ display: 'block', width: '6rem' }} />
            <span
              className="skeleton-line"
              style={{ display: 'block', width: '10rem', height: '2rem', marginTop: '0.35rem' }}
            />
          </div>
        </header>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Kontakt</h2>
          <dl className={styles.rows}>
            {CONTACT_ROWS.map((row) => (
              <div className={styles.detailRow} key={row}>
                <dt>
                  <span className="skeleton-line" style={{ display: 'block', width: '4.5rem' }} />
                </dt>
                <dd>
                  <span className="skeleton-line" style={{ display: 'block', width: '70%' }} />
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Die Anfrage</h2>
          <dl className={styles.rows}>
            {REQUEST_ROWS.map((row) => (
              <div className={styles.detailRow} key={row}>
                <dt>
                  <span className="skeleton-line" style={{ display: 'block', width: '5.5rem' }} />
                </dt>
                <dd>
                  <span className="skeleton-line" style={{ display: 'block', width: '60%' }} />
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* The action panel, reserved at full height. Its contents are deliberately
            not drawn as a button: a grey rectangle that looks pressable during a load
            is worse than an obvious placeholder. */}
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Angebot</h2>
          <span
            className="skeleton"
            style={{ display: 'block', width: '14rem', maxWidth: '100%', height: '2.75rem', marginTop: '0.75rem' }}
          />
          <p className={styles.note}>
            <span className="skeleton-line" style={{ display: 'block', width: '90%' }} />
          </p>
        </section>
      </div>
    </main>
  )
}
