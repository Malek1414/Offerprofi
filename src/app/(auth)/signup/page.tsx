/**
 * S1 — signup page shell (F0.6).
 *
 * Server component. It resolves the branding and hands the interactive part to
 * `SignupForm`; nothing here needs the client, and keeping the shell on the server
 * means the copy is in the HTML for a phone on a bad connection in a venue car park.
 */

import type { Metadata } from 'next'
import Link from 'next/link'

import styles from '../auth.module.css'
import { SignupForm } from './signup-form'
import { branding, isPlaceholderBranding } from '../../../lib/branding'

export const metadata: Metadata = {
  title: 'Konto erstellen',
}

export default function SignupPage() {
  const brand = branding()

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.masthead}>
          <span className={styles.wordmark}>{brand.productName}</span>
        </div>

        <h1 className={styles.title}>Konto erstellen</h1>
        <p className={styles.lede}>
          In wenigen Minuten eingerichtet. Danach laden Sie drei Ihrer bisherigen Angebote hoch —
          daraus entsteht Ihr Leistungskatalog.
        </p>

        <SignupForm chatDomain={brand.chatDomain} />

        <p className={styles.alt}>
          Sie haben schon ein Konto? <Link href="/login">Anmelden</Link>
        </p>
      </div>

      {/* Art. 13 duty starts at collection, not at first inquiry — this form is the
          first personal data the product takes from anyone. */}
      <p className={styles.legal}>
        Mit dem Erstellen eines Kontos stimmen Sie unseren{' '}
        <Link href="/agb">Nutzungsbedingungen</Link> zu. Wie wir Ihre Daten verarbeiten, steht in
        der <Link href="/datenschutz">Datenschutzerklärung</Link>.
        {isPlaceholderBranding(brand) && (
          <>
            {' '}
            <strong>Hinweis:</strong> Diese Installation läuft noch auf Platzhalter-Adressen.
          </>
        )}
      </p>
    </main>
  )
}
