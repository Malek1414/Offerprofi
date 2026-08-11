/**
 * `/inbox` — where an owner who has finished onboarding actually lands (Phase F).
 *
 * Until now the root router sent her here and she got a 404, which is the most
 * visible failure in the product: the screen after "you're set up" did not exist.
 *
 * Read-only on purpose. The loop runs over WhatsApp — he is told a request has
 * arrived and replies in his own words — and this is where he looks things up
 * afterwards. Building a dashboard that competes with the conversation would be
 * building the tool the personas already refuse to open.
 *
 * Server component. Nothing here is interactive except the links.
 */

import type { Metadata } from 'next'
import Link from 'next/link'

import styles from './inbox.module.css'
import { DriftCards } from './drift-card'
import { requireUserId } from '../../auth/current-user'
import { openDrift } from '../../drift/repository'
import { currentAgency } from '../../onboarding/repository'
import { listInbox } from '../../inbox/repository'
import { relativeTime, requestOneLiner, stateLabel } from '../../inbox/labels'
import { branding, isPlaceholderBranding } from '../../lib/branding'

export const metadata: Metadata = {
  title: 'Anfragen',
}

export const dynamic = 'force-dynamic'

export default async function InboxPage() {
  const userId = await requireUserId('/inbox')
  const agency = await currentAgency(userId)

  if (!agency) {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <h1 className={styles.title}>Kein Unternehmen verknüpft</h1>
        </div>
      </main>
    )
  }

  const rows = await listInbox(userId)
  const waiting = rows.filter((r) => stateLabel(r.state).urgency === 'waiting').length
  const brand = branding()

  // C4. Here rather than on `/candidates`, because the candidate queue is the
  // onboarding screen and she stops opening it the week she finishes. A nudge that
  // only appears somewhere she no longer goes is a nudge nobody receives.
  const drift = await openDrift(userId, agency.agencyId)

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>{agency.agencyName}</span>
            <h1 className={styles.title}>Anfragen</h1>
          </div>
          <span className={styles.count}>
            {waiting > 0
              ? `${waiting} ${waiting === 1 ? 'wartet' : 'warten'} auf Sie`
              : `${rows.length} insgesamt`}
          </span>
        </header>

        {drift.length > 0 && <DriftCards cards={drift} found={drift.length} />}

        {rows.length === 0 ? (
          <div className={styles.empty}>
            <h2 className={styles.emptyTitle}>Noch keine Anfragen</h2>
            <p className={styles.emptyBody}>
              Sobald jemand über Ihren Link schreibt, steht die Anfrage hier — schon gelesen,
              zusammengefasst und mit einem Preisvorschlag für Sie.
            </p>
            {/* The empty state is the one screen where the link is the point, so it
                is the one screen that must not print a placeholder domain as
                though it worked. */}
            {agency.slug && !isPlaceholderBranding(brand) ? (
              <p className={styles.emptyBody}>
                Ihr Link: <code>{`${brand.chatDomain}/a/${agency.slug}`}</code>
              </p>
            ) : (
              <Link className={styles.link} href="/onboarding">
                Einrichtung ansehen
              </Link>
            )}
          </div>
        ) : (
          <ul className={styles.list}>
            {rows.map((row) => {
              const label = stateLabel(row.state)
              const waitingOnHim = label.urgency === 'waiting'
              return (
                <li key={row.inquiryId}>
                  <Link
                    href={`/inbox/${row.inquiryId}`}
                    className={`${styles.row} ${waitingOnHim ? styles.rowWaiting : ''}`}
                  >
                    <div className={styles.rowTop}>
                      <span className={styles.who}>
                        {/* The two halves side by side, which is exactly what the
                            partition is for: the engine cannot reach her name, he
                            always can. */}
                        {row.contact?.name?.trim() || 'Ohne Namen'}
                      </span>
                      <span className={styles.when}>{relativeTime(row.firstMessageAt)}</span>
                    </div>
                    <p className={styles.summary}>{requestOneLiner(row.request)}</p>
                    <div className={styles.badges}>
                      <span
                        className={`${styles.badge} ${waitingOnHim ? styles.badgeWaiting : ''}`}
                      >
                        {label.text}
                      </span>
                      {row.automationPaused ? (
                        <span className={`${styles.badge} ${styles.badgePaused}`}>
                          Assistent pausiert
                        </span>
                      ) : null}
                      {row.ownerToken ? <span className={styles.badge}>Abgeschickt</span> : null}
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </main>
  )
}
