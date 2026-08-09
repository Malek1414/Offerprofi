/**
 * S9 — onboarding shell (F2.12, F2.3).
 *
 * Where signup lands, and where an owner returns until her catalogue is live.
 *
 * Acceptance for F2.12 is "the owner always knows what is left", and the whole screen
 * is built around that single sentence: a count rather than a percentage, the
 * outstanding steps carrying the reason they exist, and the completed ones receding
 * instead of celebrating. The measure that matters is ≥70% unaided completion, and
 * that number is lost one confused owner at a time.
 *
 * Server component throughout. Nothing on it is interactive except the links and the
 * sign-out button, so there is no reason to ship a bundle for it.
 */

import type { Metadata } from 'next'
import Link from 'next/link'

import styles from './onboarding.module.css'
import { requireUserId } from '../../auth/current-user'
import { currentAgency, onboardingState } from '../../onboarding/repository'
import {
  onboardingProgress,
  requirementExplanation,
  type RequirementId,
} from '../../onboarding/progress'
import { branding, isPlaceholderBranding } from '../../lib/branding'
import { SignOutButton } from './sign-out-button'

export const metadata: Metadata = {
  title: 'Einrichtung',
}

/** Where each outstanding requirement sends the owner, and what the button says. */
const ACTIONS: Record<RequirementId, { href: string; label: string } | null> = {
  past_quotes: { href: '/onboarding/uploads', label: 'Angebote indexieren' },
  confirmed_items: { href: '/onboarding/catalogue', label: 'Leistungen anlegen' },
  price_rules: { href: '/onboarding/catalogue', label: 'Preise hinterlegen' },
  brand: { href: '/onboarding/brand', label: 'Markenauftritt festlegen' },
  guardrails: { href: '/onboarding/guardrails', label: 'Grenzen festlegen' },
}

export default async function OnboardingPage() {
  const userId = await requireUserId('/onboarding')
  const agency = await currentAgency(userId)

  // A signed-in user with no agency should not be possible — bootstrap_agency writes
  // the membership in the same transaction as the user (F0.7). If it happens, the
  // account is unusable and saying so beats rendering an empty checklist.
  if (!agency) {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <h1 className={styles.title}>Kein Unternehmen verknüpft</h1>
          <p className={styles.lede}>
            Zu diesem Konto gehört noch kein Unternehmen. Bitte wenden Sie sich an den Support —
            das sollte nicht passieren.
          </p>
        </div>
      </main>
    )
  }

  const state = await onboardingState(userId)
  const progress = onboardingProgress(state)
  const brand = branding()
  const done = progress.requirements.length - progress.remaining.length

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <span className={styles.eyebrow}>{agency.agencyName}</span>
          <h1 className={styles.title}>
            {progress.complete ? 'Sie sind startklar' : 'Noch ein paar Schritte'}
          </h1>
          <p className={styles.lede}>
              {progress.complete
                ? 'Ihr Katalog steht. Ab jetzt qualifiziert der Assistent neue Anfragen und ' +
                  'bereitet für Sie eine Kalkulationshilfe vor. Erst Sie geben das Angebot frei.'
                : 'Danach qualifiziert der Assistent Anfragen und bereitet eine Kalkulationshilfe ' +
                  'nach Ihren eigenen Preisen vor. Erst Sie entscheiden, was an die Kundin geht.'}
          </p>
        </header>

        <div className={styles.progress}>
          <span className={styles.progressCount}>
            {done} von {progress.requirements.length}
          </span>
          <span className={styles.progressLabel}>
            {progress.complete ? 'abgeschlossen' : 'Schritten erledigt'}
          </span>
        </div>
        <div
          className={styles.bar}
          role="progressbar"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={progress.requirements.length}
          aria-label="Fortschritt der Einrichtung"
        >
          <div className={styles.barFill} style={{ width: `${progress.ratio * 100}%` }} />
        </div>

        <ol className={styles.steps}>
          {progress.requirements.map((requirement) => {
            const copy = requirementExplanation(requirement.id, 'de')
            const action = ACTIONS[requirement.id]
            return (
              <li
                key={requirement.id}
                className={[
                  styles.step,
                  requirement.met ? styles.stepDone : '',
                  requirement.blocked ? styles.stepBlockedRow : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span
                  className={`${styles.marker} ${requirement.met ? styles.markerDone : ''}`}
                  aria-hidden="true"
                >
                  {requirement.met ? '✓' : ''}
                </span>
                <span className={styles.stepTitle}>{copy.title}</span>

                {/* A count only where counting means something. "1 von 1" for the
                    brand step is noise dressed as information, and "0 / 0" on a
                    blocked step is worse — it looks like a failure. */}
                {requirement.target > 1 && !requirement.blocked && (
                  <span className={styles.stepCount}>
                    {Math.min(requirement.current, requirement.target)} / {requirement.target}
                  </span>
                )}

                {/* The reason, on outstanding steps only (F2.3). */}
                {!requirement.met && <p className={styles.stepWhy}>{copy.why}</p>}

                {/* A blocked step gets no button, because there is nothing yet to
                    click — but it stays visible, so the shape of the whole setup is
                    known from the first screen rather than appearing step by step. */}
                {requirement.blocked ? (
                  <p className={styles.stepBlocked}>Sobald Sie Leistungen angelegt haben.</p>
                ) : (
                  !requirement.met &&
                  action && (
                    <Link className={styles.stepAction} href={action.href}>
                      {action.label}
                    </Link>
                  )
                )}
              </li>
            )
          })}
        </ol>

        <section className={styles.linkCard}>
          <p className={styles.linkCardTitle}>Ihr Link für Anfragen</p>
          <p className={styles.linkCardWhy}>
            Dieser Link gehört in Ihre Instagram-Bio, auf Ihre Website und auf Ihre Visitenkarte.
            Wer ihn öffnet, bekommt innerhalb von Sekunden eine Antwort — auch nachts.
          </p>
          <code className={styles.link}>
            {brand.chatDomain}/a/{agency.slug ?? '…'}
          </code>
          {isPlaceholderBranding(brand) && (
            <p className={styles.placeholderNote}>
                Diese Installation läuft lokal. Für einen öffentlichen Link tragen Sie beim
                Deployment die endgültige Domain ein.
            </p>
          )}
        </section>

        <footer className={styles.footer}>
          <span>
            Angemeldet als {agency.ownerDisplayName ?? 'Sie'} · {agency.agencyName}
          </span>
          <SignOutButton />
        </footer>
      </div>
    </main>
  )
}
