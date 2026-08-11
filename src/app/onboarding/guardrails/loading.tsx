/**
 * `/onboarding/guardrails` while the saved limits load (D1).
 *
 * The acceptance criterion for this screen is a stopwatch — fillable in under three
 * minutes — and the clock starts when the owner arrives, not when the query returns.
 * Reserving all nine setting rows means the scroll length is right from the first
 * frame, so she can already see how long the form is while it is still loading.
 *
 * Nine rows, because there are exactly nine settings on this screen. Like the
 * onboarding checklist, this is not a guess at the shape.
 */

import styles from './guardrails.module.css'

const GROUPS = [
  { title: 'Was landet bei Ihnen zur Prüfung?', rows: 3 },
  { title: 'Wie weit darf der Assistent gehen?', rows: 4 },
  { title: 'Wann sind Sie verfügbar?', rows: 2 },
]

export default function GuardrailsLoading() {
  return (
    <main className={styles.page} aria-busy="true" aria-label="Leitplanken werden geladen">
      <div className={styles.shell}>
        <span className={styles.back}>← Einrichtung</span>
        <h1 className={styles.title}>Ihre Grenzen</h1>
        <p className={styles.lede}>
          <span className="skeleton-line" style={{ display: 'block', width: '100%' }} />
          <span className="skeleton-line" style={{ display: 'block', width: '60%', marginTop: '0.35rem' }} />
        </p>

        {GROUPS.map((group) => (
          <section className={styles.group} key={group.title}>
            {/* The group headings are ours, not the database's, so they are shown for
                real. A skeleton where a known constant belongs is theatre. */}
            <h2 className={styles.groupTitle}>{group.title}</h2>
            <div className={styles.settings}>
              {Array.from({ length: group.rows }, (_, row) => (
                <div className={styles.setting} key={row}>
                  <span className={styles.settingLabel}>
                    <span className="skeleton-line" style={{ display: 'block', width: '12rem', maxWidth: '100%' }} />
                  </span>
                  <div className={styles.control}>
                    <span className="skeleton" style={{ display: 'block', width: '8.5rem', height: '2.75rem' }} />
                  </div>
                  <p className={styles.settingHelp}>
                    <span className="skeleton-line" style={{ display: 'block', width: '90%' }} />
                  </p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}
