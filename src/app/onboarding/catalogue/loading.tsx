/**
 * `/onboarding/catalogue` while the catalogue and its price ladders load (D1).
 *
 * Two queries in parallel, and the owner arrives here repeatedly — she enters five
 * services one at a time and comes back to check them. The form below the list is the
 * part she is aiming for, so the list above it must reserve its height rather than
 * push the form down as rows appear.
 *
 * Three list rows is the deliberate compromise: the real count is unknown until the
 * query returns, and three is roughly where an owner is on her second visit. Under-
 * reserving pushes the form down when the data lands; over-reserving pulls it up.
 * Three is the smaller of the two errors on the visit that matters most.
 */

import styles from './catalogue.module.css'

const ITEMS = [0, 1, 2]

export default function CatalogueLoading() {
  return (
    <main className={styles.page} aria-busy="true" aria-label="Leistungen werden geladen">
      <div className={styles.shell}>
        <span className={styles.back}>← Einrichtung</span>
        <h1 className={styles.title}>Ihre Leistungen</h1>
        <p className={styles.lede}>
          <span className="skeleton-line" style={{ display: 'block', width: '100%' }} />
          <span className="skeleton-line" style={{ display: 'block', width: '70%', marginTop: '0.35rem' }} />
        </p>

        <ul className={styles.list}>
          {ITEMS.map((item) => (
            <li className={styles.item} key={item}>
              <span className={styles.itemName}>
                <span className="skeleton-line" style={{ display: 'block', width: '11rem', maxWidth: '100%' }} />
              </span>
              <span className={styles.itemPrice}>
                <span className="skeleton-line" style={{ display: 'block', width: '5rem' }} />
              </span>
              <span className={styles.itemMeta}>
                <span className="skeleton-line" style={{ display: 'block', width: '80%' }} />
              </span>
            </li>
          ))}
        </ul>

        <div className={styles.form}>
          <h2 className={styles.formTitle}>Leistung hinzufügen</h2>
          <span className="skeleton-line" style={{ display: 'block', width: '9rem' }} />
          <span
            className="skeleton"
            style={{ display: 'block', width: '100%', height: '2.75rem', margin: '0.35rem 0 1.1rem' }}
          />
          <span className="skeleton-line" style={{ display: 'block', width: '7rem' }} />
          <span
            className="skeleton"
            style={{ display: 'block', width: '100%', height: '4.5rem', margin: '0.35rem 0 1.1rem' }}
          />
        </div>
      </div>
    </main>
  )
}
