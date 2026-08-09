/**
 * `/inbox/{id}` — one enquiry, in full (Phase F).
 *
 * The lookup screen. Everything actionable happens over WhatsApp; this is where
 * he checks what she actually said three weeks ago, which the conversation does
 * not make easy and a document does.
 *
 * No price suggestion here: that lives on `/r/{token}`, which is one document
 * rendered once from one place. Duplicating it would mean two renderers of the
 * same figures, and the second one is where they diverge.
 */

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import styles from '../inbox.module.css'
import { requireUserId } from '../../../auth/current-user'
import { loadInquiry } from '../../../inbox/repository'
import { relativeTime, stateLabel } from '../../../inbox/labels'
import { requestRows } from '../../../requests/summary'

export const metadata: Metadata = {
  title: 'Anfrage',
}

export const dynamic = 'force-dynamic'

export default async function InquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = await requireUserId(`/inbox/${id}`)

  const inquiry = await loadInquiry(userId, id)
  // Covers "no such inquiry" and "another tenant's" alike — RLS turned the second
  // into the first before this code ran, so there is nothing here to leak.
  if (!inquiry) notFound()

  const label = stateLabel(inquiry.state)
  // The owner audience, so the budget she mentioned and the low-confidence marks
  // are both included. This is his screen.
  const rows = inquiry.request ? requestRows(inquiry.request, 'owner', 'de') : []

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link href="/inbox" className={styles.back}>
          ← Alle Anfragen
        </Link>

        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>{label.text}</span>
            <h1 className={styles.title}>{inquiry.contact?.name?.trim() || 'Ohne Namen'}</h1>
          </div>
          <span className={styles.count}>{relativeTime(inquiry.firstMessageAt)}</span>
        </header>

        {inquiry.contact ? (
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Kontakt</h2>
            <dl className={styles.rows}>
              {inquiry.contact.email ? (
                <div className={styles.detailRow}>
                  <dt>E-Mail</dt>
                  <dd>
                    <a href={`mailto:${inquiry.contact.email}`}>{inquiry.contact.email}</a>
                  </dd>
                </div>
              ) : null}
              {inquiry.contact.phoneE164 ? (
                <div className={styles.detailRow}>
                  <dt>Telefon</dt>
                  <dd>
                    <a href={`tel:${inquiry.contact.phoneE164}`}>{inquiry.contact.phoneE164}</a>
                  </dd>
                </div>
              ) : null}
              {inquiry.contact.company ? (
                <div className={styles.detailRow}>
                  <dt>Firma</dt>
                  <dd>{inquiry.contact.company}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        ) : null}

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Die Anfrage</h2>
          {rows.length ? (
            <dl className={styles.rows}>
              {rows.map((row) => (
                <div className={styles.detailRow} key={row.field}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className={styles.note}>
              Zu dieser Anfrage wurde noch nichts strukturiert erfasst — der Gesprächsverlauf
              steht unten.
            </p>
          )}
          {inquiry.escalationReason ? (
            <p className={styles.note}>
              {/* The internal reason, shown plainly rather than dressed up. He is
                  entitled to know why the assistant stepped back — but never as
                  something that happened *to the customer*. */}
              Der Assistent hat übergeben. Grund: {inquiry.escalationReason}
            </p>
          ) : null}
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Verlauf</h2>
          {inquiry.messages.length ? (
            <div className={styles.transcript}>
              {inquiry.messages.map((message) => (
                <div
                  key={message.id}
                  className={`${styles.msg} ${
                    message.direction === 'inbound' ? styles.msgIn : styles.msgOut
                  }`}
                >
                  {message.text}
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.note}>Keine gespeicherten Nachrichten.</p>
          )}
          {/* Honest about a real gap rather than letting him wonder why the
              assistant's half is missing. */}
          <p className={styles.note}>
            Gespeichert werden derzeit die Nachrichten der Kundin; die Antworten des
            Assistenten noch nicht.
          </p>
        </section>
      </div>
    </main>
  )
}
