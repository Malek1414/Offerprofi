import type { Metadata } from 'next'
import Link from 'next/link'

import styles from '../legal.module.css'
import { branding } from '../../lib/branding'
import { legalProfile } from '../../lib/legal-profile'

export const metadata: Metadata = { title: 'Datenschutz' }

export default function PrivacyPage() {
  const brand = branding()
  const legal = legalProfile()

  return (
    <main className={styles.page}>
      <article className={styles.document}>
        <Link className={styles.brand} href="/">{brand.productName}</Link>
        <h1 className={styles.title}>Datenschutzhinweise</h1>
        <p className={styles.updated}>Technischer Sachstand: 9. August 2026</p>
        <p className={styles.lede}>
          Diese Seite beschreibt transparent, welche Daten {brand.productName} technisch verarbeitet.
          Die rechtliche Einordnung und die Angaben der verantwortlichen Stelle müssen vor einem
          öffentlichen Einsatz mit Datenschutzberatung und dem jeweiligen Caterer vervollständigt werden.
        </p>

        <div className={styles.warning} role="note">
          <strong>Rechtliche Prüfung ausstehend</strong>
          Rechtsgrundlagen, konkrete Löschfristen, Aufsichtsbehörde und die Rollenverteilung zwischen
          Caterer und Plattformbetreiber sind nicht abschließend festgelegt. Dieser Hinweis ersetzt
          keine geprüfte Datenschutzerklärung.
        </div>

        <section className={styles.section}>
          <h2>Wer verarbeitet die Daten?</h2>
          <p>
            Für eine konkrete Catering-Anfrage ist grundsätzlich der Caterer verantwortlich, dessen
            Name im Chat steht. {brand.productName} stellt die technische Verarbeitung bereit. Betreiber:
          </p>
          <p className={!legal.complete ? styles.missing : undefined}>
            {legal.companyName ?? '[Unternehmensname ergänzen]'}
            {legal.street ? <><br />{legal.street}</> : null}
            {legal.postalCode || legal.city ? <><br />{[legal.postalCode, legal.city].filter(Boolean).join(' ')}</> : null}
            {legal.email ? <><br /><a href={`mailto:${legal.email}`}>{legal.email}</a></> : null}
          </p>
          {!legal.complete && <p className={styles.missing}>Vollständige Betreiber- und Kontaktangaben fehlen noch.</p>}
        </section>

        <section className={styles.section}>
          <h2>Welche Daten werden verarbeitet?</h2>
          <ul>
            <li>Kontodaten von Caterern: Name, geschäftliche E-Mail, Passwort-Hash, Firma und Sitzungsdaten.</li>
            <li>Anfragedaten: Nachrichten, Kontaktdaten, Veranstaltungsart, Datum, Ort, Gästezahl und Wünsche.</li>
            <li>Aus den Nachrichten strukturierte Angaben, Rückfragen, Status und die erzeugten Anfrage-Dokumente.</li>
            <li>Technische Nachweise: Einwilligungs-/Hinweisversion, Zugriffs- und Auditereignisse sowie Modellnutzung und Kosten.</li>
            <li>Frühere Angebote des Caterers: Dateiname und extrahierter Text. Die hochgeladene Originaldatei wird nicht gespeichert.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>Wofür werden die Daten genutzt?</h2>
          <p>
            Zur Entgegennahme und Qualifizierung von Catering-Anfragen, zur Übergabe an den Caterer,
            zur Erzeugung nicht bindender Dokumente, zur Kontosicherheit und zur nachvollziehbaren
            Abrechnung der Modellnutzung. Eine Anfrage wird nicht automatisch abgelehnt und ein
            Angebot wird erst durch den Caterer verbindlich.
          </p>
          <p className={styles.missing}>Die einschlägigen Rechtsgrundlagen sind vor Veröffentlichung juristisch festzulegen.</p>
        </section>

        <section className={styles.section}>
          <h2>KI-Verarbeitung und Empfänger</h2>
          <ul>
            <li>
              Wenn die KI-Funktionen aktiviert sind, werden die für Extraktion oder Rückfrage nötigen
              Textausschnitte an Anthropic übermittelt. Kundentext wird als nicht vertrauenswürdige
              Nutzlast gekennzeichnet; Preise werden nicht vom Modell berechnet.
            </li>
            <li>
              In der Datenbank werden zu Modellaufrufen Inhalts-Hashes, Modell, Laufzeit, Tokenzahl und
              Kosten gespeichert, keine zweite Kopie von Prompt oder Antwort.
            </li>
            <li>Geschäftsdaten liegen in PostgreSQL; die Produktionsinstanz ist für eine EU-Region vorgesehen.</li>
            <li>Unipile/WhatsApp wird nur verarbeitet, wenn ein Caterer diesen Kanal ausdrücklich verbindet.</li>
          </ul>
          <p className={styles.missing}>
            Hostinganbieter, Auftragsverarbeitungsverträge, Drittlandtransfer und die tatsächliche
            Aktivierung einer Zero-Retention-Konfiguration sind vor Produktivbetrieb zu dokumentieren.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Speicherung und Löschung</h2>
          <p>
            Konten, Anfragen, Nachrichten, Dokumenttexte und Nachweise bleiben derzeit in der
            Mandantendatenbank gespeichert, bis sie administrativ gelöscht werden. Sitzungen laufen
            technisch ab und können widerrufen werden. Hochgeladene PDF-/TXT-Binärdateien werden nach
            der Textextraktion verworfen.
          </p>
          <p className={styles.missing}>Verbindliche Löschfristen und ein produktiver Löschprozess sind noch festzulegen.</p>
        </section>

        <section className={styles.section}>
          <h2>Ihre Rechte und Kontakt</h2>
          <p>
            Betroffene Personen können sich wegen Auskunft, Berichtigung, Löschung, Einschränkung,
            Datenübertragbarkeit oder Widerspruch zunächst an den im Chat genannten Caterer wenden.
          </p>
          <p className={!legal.privacyContact ? styles.missing : undefined}>
            Datenschutzkontakt:{' '}
            {legal.privacyContact ? <a href={`mailto:${legal.privacyContact}`}>{legal.privacyContact}</a> : '[Kontakt ergänzen]'}
          </p>
        </section>

        <footer className={styles.footer}>
          <Link href="/impressum">Impressum</Link>
          <Link href="/agb">Nutzungsbedingungen</Link>
        </footer>
      </article>
    </main>
  )
}
