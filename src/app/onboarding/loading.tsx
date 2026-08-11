/**
 * `/onboarding` while the checklist is computed (D1).
 *
 * This is the screen signup lands on, so it is the first thing an owner sees after
 * handing over her details — the single worst moment in the product to show a blank
 * page or a spinner. It does four round trips (session, agency, onboarding state,
 * progress) before it can say anything.
 *
 * The five step rows are reserved because there are always exactly five: the
 * requirement list is fixed in src/onboarding/progress.ts, so this skeleton is not a
 * guess at the shape, it is the shape. When the data lands the rows fill in and
 * nothing moves.
 */

import styles from './onboarding.module.css'

const STEPS = [0, 1, 2, 3, 4]

export default function OnboardingLoading() {
  return (
    <main className={styles.page} aria-busy="true" aria-label="Einrichtung wird geladen">
      <div className={styles.shell}>
        <header className={styles.header}>
          <span className="skeleton-line" style={{ display: 'block', width: '12rem' }} />
          <span
            className="skeleton-line"
            style={{ display: 'block', width: '16rem', maxWidth: '100%', height: '2.6rem', marginTop: '0.35rem' }}
          />
          <p className={styles.lede}>
            <span className="skeleton-line" style={{ display: 'block', width: '100%' }} />
            <span
              className="skeleton-line"
              style={{ display: 'block', width: '75%', marginTop: '0.35rem' }}
            />
          </p>
        </header>

        <div className={styles.progress}>
          <span className="skeleton-line" style={{ width: '5rem', height: '1.4rem' }} />
          <span className="skeleton-line" style={{ width: '8rem' }} />
        </div>
        {/* The bar is 4px of real chrome either way, so it is drawn rather than
            faked — an empty track is an honest "nought of five so far". */}
        <div className={styles.bar} />

        <ol className={styles.steps}>
          {STEPS.map((step) => (
            <li className={styles.step} key={step}>
              <span className={styles.marker} aria-hidden="true" />
              <span className={styles.stepTitle}>
                <span className="skeleton-line" style={{ display: 'block', width: '13rem', maxWidth: '100%' }} />
              </span>
              <p className={styles.stepWhy}>
                <span className="skeleton-line" style={{ display: 'block', width: '100%' }} />
                <span
                  className="skeleton-line"
                  style={{ display: 'block', width: '65%', marginTop: '0.3rem' }}
                />
              </p>
            </li>
          ))}
        </ol>
      </div>
    </main>
  )
}
