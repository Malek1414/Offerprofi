import type { Metadata } from 'next'
import Link from 'next/link'

import styles from '../legal.module.css'
import { branding } from '../../lib/branding'
import { legalProfile } from '../../lib/legal-profile'

export const metadata: Metadata = { title: 'Impressum' }

const Missing = ({ children }: { children: React.ReactNode }) => <span className={styles.missing}>{children}</span>

export default function ImprintPage() {
  const brand = branding()
  const legal = legalProfile()

  return (
    <main className={styles.page}>
      <article className={styles.document}>
        <Link className={styles.brand} href="/">{brand.productName}</Link>
        <h1 className={styles.title}>Impressum</h1>

        {!legal.complete && (
          <div className={styles.warning} role="note">
            <strong>Noch nicht veröffentlichungsfertig</strong>
            Die gesetzlich erforderlichen Betreiberangaben wurden nicht konfiguriert. Die Seite ist
            vorhanden, kennzeichnet fehlende Fakten aber bewusst, statt sie zu erfinden.
          </div>
        )}

        <section className={styles.section}>
          <h2>Anbieter</h2>
          <address>
            {legal.companyName ?? <Missing>[Unternehmensname ergänzen]</Missing>}<br />
            {legal.street ?? <Missing>[Straße und Hausnummer ergänzen]</Missing>}<br />
            {legal.postalCode ?? <Missing>[PLZ]</Missing>} {legal.city ?? <Missing>[Ort ergänzen]</Missing>}<br />
            {legal.country}
          </address>
        </section>

        <section className={styles.section}>
          <h2>Vertretungsberechtigt</h2>
          <p>{legal.representative ?? <Missing>[Name ergänzen]</Missing>}</p>
        </section>

        <section className={styles.section}>
          <h2>Kontakt</h2>
          <p>
            E-Mail:{' '}
            {legal.email ? <a href={`mailto:${legal.email}`}>{legal.email}</a> : <Missing>[E-Mail ergänzen]</Missing>}<br />
            Telefon: {legal.phone ?? <Missing>[Telefon ergänzen]</Missing>}
          </p>
        </section>

        <section className={styles.section}>
          <h2>Register und Umsatzsteuer</h2>
          <p>
            Registergericht: {legal.registerCourt ?? <Missing>[falls einschlägig ergänzen]</Missing>}<br />
            Registernummer: {legal.registerNumber ?? <Missing>[falls einschlägig ergänzen]</Missing>}<br />
            USt-IdNr.: {legal.vatId ?? <Missing>[falls vorhanden ergänzen]</Missing>}
          </p>
        </section>

        <footer className={styles.footer}>
          <Link href="/datenschutz">Datenschutz</Link>
          <Link href="/agb">Nutzungsbedingungen</Link>
        </footer>
      </article>
    </main>
  )
}
