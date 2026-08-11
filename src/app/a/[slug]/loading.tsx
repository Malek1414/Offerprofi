/**
 * `/a/{slug}` while the agency is resolved (D1).
 *
 * This is the first frame of the whole product for an end customer: she has tapped a
 * link in an Instagram bio, on a phone, on mobile data, and whatever appears here is
 * her first impression of an agency that is not us. A spinner would spend that
 * impression on nothing.
 *
 * Two things are reserved exactly. The header, because the AI disclosure and the
 * agency name land there and the transcript must not shunt downward when they do.
 * And the composer, because it is sticky to the bottom of the viewport and it is the
 * only control on the screen — it appears in its final position in the first frame
 * and stays there.
 *
 * No brand colour anywhere: the agency's palette arrives with the data this skeleton
 * is waiting for, and guessing at it would mean the page changes colour on load,
 * which is the most conspicuous layout shift there is even though nothing moves.
 */

import styles from './chat.module.css'

export default function ChatLoading() {
  return (
    <div className={styles.shell} aria-busy="true" aria-label="Chat wird geladen">
      <header className={styles.header}>
        <span className={`${styles.logo} skeleton`} />
        <div className={styles.identity}>
          <span className="skeleton-line" style={{ display: 'block', width: '10rem', maxWidth: '100%' }} />
          <span
            className="skeleton-line"
            style={{ display: 'block', width: '6rem', marginTop: '0.25rem' }}
          />
        </div>
      </header>

      <div className={styles.transcript}>
        <div className={styles.empty}>
          <span
            className="skeleton-line"
            style={{ display: 'block', width: '12rem', maxWidth: '100%', height: '2.2rem' }}
          />
          <span className="skeleton-line" style={{ display: 'block', width: '100%', marginTop: '0.6rem' }} />
          <span className="skeleton-line" style={{ display: 'block', width: '80%', marginTop: '0.3rem' }} />
          {/* The disclosure notice and the privacy notice, at the heights they will
              occupy. Both are legally required to be on this screen, so both are part
              of the layout rather than something that appears later. */}
          <span className="skeleton" style={{ display: 'block', width: '100%', height: '5.5rem', marginTop: '1.25rem' }} />
          <span className="skeleton" style={{ display: 'block', width: '100%', height: '3.5rem', marginTop: '0.6rem' }} />
        </div>
      </div>

      <div className={styles.composer}>
        <span className={`${styles.input} skeleton`} />
        <span className="skeleton" style={{ width: '5.5rem', height: '2.75rem', flex: 'none' }} />
      </div>
    </div>
  )
}
