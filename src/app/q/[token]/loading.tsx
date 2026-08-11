/**
 * `/q/{token}` while the quote is read back (D1).
 *
 * The customer opened this from an email or a WhatsApp message, usually within
 * minutes of being told it exists, and she is looking for one number. The Briefkopf,
 * the line items and the totals block are all reserved at their real heights so the
 * grand total does not slide up the page as the lines above it resolve — a figure
 * that moves while someone is reading it is the one animation this document must
 * never have.
 *
 * Three line rows: a small agency's quote is typically two to five positions, and
 * three is the middle of that. Getting it wrong costs a few pixels of settle at the
 * bottom of the document, below the fold on a phone, rather than under the total.
 */

import styles from './quote.module.css'

const LINES = [0, 1, 2]

export default function QuoteLoading() {
  return (
    <article className={styles.doc} aria-busy="true" aria-label="Angebot wird geladen">
      <header className={styles.head}>
        <div className={styles.ident}>
          <span
            className="skeleton-line"
            style={{ display: 'block', width: '12rem', maxWidth: '100%', height: '1.6rem', marginBottom: '0.6rem' }}
          />
          <span className="skeleton-line" style={{ display: 'block', width: '9rem' }} />
          <span className="skeleton-line" style={{ display: 'block', width: '7rem', marginTop: '0.25rem' }} />
        </div>
        <div>
          <span className="skeleton-line" style={{ display: 'block', width: '9rem' }} />
          <span className="skeleton-line" style={{ display: 'block', width: '9rem', marginTop: '0.35rem' }} />
        </div>
      </header>

      <section className={styles.subject}>
        <span
          className="skeleton-line"
          style={{ display: 'block', width: '16rem', maxWidth: '100%', height: '2.6rem' }}
        />
        <p className={styles.recipient}>
          <span className="skeleton-line" style={{ display: 'block', width: '11rem' }} />
        </p>
      </section>

      <ul className={styles.lineList}>
        {LINES.map((line) => (
          <li key={line}>
            <div className={styles.row}>
              <div className={styles.what}>
                <span className="skeleton-line" style={{ display: 'block', width: '13rem', maxWidth: '100%' }} />
                <span
                  className="skeleton-line"
                  style={{ display: 'block', width: '80%', marginTop: '0.35rem' }}
                />
              </div>
              <div className={styles.qty}>
                <span className="skeleton-line" style={{ display: 'block', width: '3rem', marginLeft: 'auto' }} />
              </div>
              <div className={styles.net}>
                <span className="skeleton-line" style={{ display: 'block', width: '5rem', marginLeft: 'auto' }} />
              </div>
            </div>
          </li>
        ))}
      </ul>

      <section className={styles.totals}>
        <dl>
          <div>
            <dt>
              <span className="skeleton-line" style={{ display: 'block', width: '6rem' }} />
            </dt>
            <dd>
              <span className="skeleton-line" style={{ display: 'block', width: '5rem', marginLeft: 'auto' }} />
            </dd>
          </div>
          <div className={styles.grand}>
            <dt>
              <span className="skeleton-line" style={{ display: 'block', width: '7rem' }} />
            </dt>
            <dd>
              <span className="skeleton-line" style={{ display: 'block', width: '6rem', marginLeft: 'auto' }} />
            </dd>
          </div>
        </dl>
      </section>

      {/* The accept panel, at full height. It is the only control on the document and
          it must not arrive under a thumb that was already moving toward it. */}
      <section className={styles.act}>
        <span className="skeleton" style={{ display: 'block', width: '100%', height: '3.4rem' }} />
        <p className={styles.subline}>
          <span className="skeleton-line" style={{ display: 'block', width: '70%', margin: '0 auto' }} />
        </p>
      </section>
    </article>
  )
}
