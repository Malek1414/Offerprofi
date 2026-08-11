/**
 * `/inbox` while the database answers (D1).
 *
 * The route is `force-dynamic` and does three round trips before it can render — the
 * session, the agency, then the enquiries — so on a phone on mobile data there is a
 * real gap here, and what fills it decides whether the product feels quick. A spinner
 * would say "wait"; this says "your list is arriving, and it is this shape".
 *
 * The skeleton is built from `inbox.module.css`, the same module the real page uses,
 * so `.page`, `.shell`, `.header` and `.row` are literally the same boxes. The only
 * thing that changes when the data lands is what is inside them: no reflow, no jump,
 * nothing under the thumb moves between the frame she looked at and the frame she
 * tapped.
 *
 * Five rows, not one and not twenty. Five fills a 390px viewport almost exactly, so
 * the page neither looks empty while loading nor promises a scroll that may not exist.
 */

import styles from './inbox.module.css'

const ROWS = [0, 1, 2, 3, 4]

export default function InboxLoading() {
  return (
    <main className={styles.page} aria-busy="true" aria-label="Anfragen werden geladen">
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            {/* Eyebrow and title, at the widths a real agency name and "Anfragen"
                occupy — narrow enough not to look like a content block, wide enough
                to hold the line open. */}
            <span className="skeleton-line" style={{ display: 'block', width: '11rem' }} />
            <span
              className="skeleton-line"
              style={{ display: 'block', width: '7rem', height: '2rem', marginTop: '0.35rem' }}
            />
          </div>
        </header>

        <ul className={styles.list}>
          {ROWS.map((row) => (
            <li key={row}>
              <div className={styles.row}>
                <div className={styles.rowTop}>
                  <span className="skeleton-line" style={{ width: '9rem' }} />
                  <span className="skeleton-line" style={{ width: '4rem' }} />
                </div>
                <p className={styles.summary}>
                  <span className="skeleton-line" style={{ display: 'block', width: '80%' }} />
                </p>
                <div className={styles.badges}>
                  <span className="skeleton" style={{ width: '5.5rem', height: '1.25rem' }} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}
