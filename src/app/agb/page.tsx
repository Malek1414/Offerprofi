import type { Metadata } from 'next'
import Link from 'next/link'

import styles from '../legal.module.css'
import { branding } from '../../lib/branding'

export const metadata: Metadata = { title: 'Nutzungsbedingungen' }

export default function TermsPage() {
  const brand = branding()

  return (
    <main className={styles.page}>
      <article className={styles.document}>
        <Link className={styles.brand} href="/">{brand.productName}</Link>
        <h1 className={styles.title}>Nutzungsbedingungen</h1>
        <p className={styles.updated}>Pilotfassung · 9. August 2026</p>

        <div className={styles.warning} role="note">
          <strong>Vertragstext noch juristisch zu prüfen</strong>
          Diese Seite hält die tatsächliche Produktfunktion fest. Individuelle Pilotvereinbarungen
          gehen vor; vor dem öffentlichen Vertrieb ist eine geprüfte Vertragsfassung einzusetzen.
        </div>

        <section className={styles.section}>
          <h2>Leistungsumfang</h2>
          <p>
            {brand.productName} unterstützt Cateringunternehmen bei der Aufnahme, Strukturierung und Übergabe
            von Kundenanfragen. KI-Ausgaben und Preisvorschläge sind Arbeitshilfen. Der Caterer prüft
            sie und entscheidet selbst, welches verbindliche Angebot er abgibt.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Keine automatische Ablehnung oder Bindung</h2>
          <p>
            Das System lehnt keine Kundenanfrage automatisch ab. Ein im System erzeugtes Dokument ist
            unverbindlich, bis der Caterer es ausdrücklich bestätigt und selbst versendet oder freigibt.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Pflichten des Kontoinhabers</h2>
          <p>
            Der Kontoinhaber hält Katalogpreise, Steuersätze, Unternehmens- und Markenangaben richtig,
            schützt seine Zugangsdaten und prüft Inhalte vor einer verbindlichen Verwendung. In
            hochgeladenen Altangeboten sollen nicht benötigte personenbezogene Daten entfernt werden.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Pilotbetrieb</h2>
          <p>
            Preis, Laufzeit, Support, Verfügbarkeit, Haftung, Kündigung und Datenexport werden für den
            Pilotbetrieb individuell vereinbart. Diese offenen Vertragspunkte werden hier nicht durch
            erfundene Standardklauseln ersetzt.
          </p>
        </section>

        <footer className={styles.footer}>
          <Link href="/datenschutz">Datenschutz</Link>
          <Link href="/impressum">Impressum</Link>
        </footer>
      </article>
    </main>
  )
}
