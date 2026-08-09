/**
 * S2 — login page shell (F0.6).
 *
 * The `next` parameter is validated *here*, on the server, before it reaches the
 * client component. An open redirect on a login page is worth more to a phisher than
 * one anywhere else: the victim arrives on our real domain, sees a real login form,
 * signs in successfully, and is then handed to the attacker — with the credibility of
 * a working authentication already spent.
 *
 * So: a path on this origin, or nothing. `//evil.example` is rejected explicitly,
 * because a protocol-relative URL passes a naive `startsWith('/')` check and is a
 * cross-origin navigation.
 */

import type { Metadata } from 'next'
import Link from 'next/link'

import styles from '../auth.module.css'
import { LoginForm } from './login-form'
import { branding } from '../../../lib/branding'
import { safeDestination } from '../../../auth/redirect'

export const metadata: Metadata = {
  title: 'Anmelden',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const brand = branding()

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.masthead}>
          <span className={styles.wordmark}>{brand.productName}</span>
        </div>

        <h1 className={styles.title}>Anmelden</h1>
        <p className={styles.lede}>Willkommen zurück.</p>

        <LoginForm next={safeDestination(params.next)} />

        <p className={styles.alt}>
          Noch kein Konto? <Link href="/signup">Konto erstellen</Link>
        </p>
      </div>
    </main>
  )
}
