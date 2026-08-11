'use client'

/**
 * The chat client — screens S4, S5, S7, S8 (F1.7, F1.8, F1.13, F1.14).
 *
 * Three things this component must get right, in order of how expensive they are
 * to get wrong:
 *
 *   1. **"mit {Owner} sprechen" always works** (F1.14, Invariant 5), including
 *      mid-stream. The button aborts the in-flight response rather than waiting
 *      politely for it, because a customer who has just asked for a human should
 *      not have to watch a robot finish its sentence first.
 *   2. **No blank wait state** (F1.7). A typing indicator appears the moment a
 *      message is sent and is replaced by text as it streams.
 *   3. **No third-party anything** (F1.12). No fonts, no analytics, no chat widget
 *      library. The CSP in next.config.ts enforces it; this file must not try.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import type { Disclosure } from '../../../domain/disclosure'
import { humanRequestedNotice, type chatStrings } from '../../../chat/conversation'
import styles from './chat.module.css'

type Strings = ReturnType<typeof chatStrings>

interface Props {
  slug: string
  agencyName: string
  ownerName: string
  logoUrl: string | null
  privacyNoticeUrl: string
  imprintUrl: string
  disclosure: Disclosure
  strings: Strings
  language: 'de' | 'en'
  formality: 'du' | 'sie'
}

type Author = 'agent' | 'customer'

interface Bubble {
  id: string
  author: Author
  text: string
  /** Notices are set apart from conversation — see chat.module.css. */
  variant?: 'notice' | 'paused'
  streaming?: boolean
}

export function ChatClient(props: Props) {
  const { strings, disclosure } = props

  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [paused, setPaused] = useState(false)
  const [honeypot, setHoneypot] = useState('')
  /** Phase D — the server said the request is complete enough to hand over. */
  const [canSend, setCanSend] = useState(false)
  const [sending, setSending] = useState(false)
  const [sentUrl, setSentUrl] = useState<string | null>(null)
  const [sendFailed, setSendFailed] = useState(false)

  const transcriptRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  /** F1.11 — how long the customer took. A bot answers faster than a person can read. */
  const renderedAt = useRef<number>(Date.now())
  const lastSent = useRef<string>('')
  /**
   * A1 — `send` runs before `sendRequest` is declared, and the stream that decides
   * to press it is consumed inside `send`. A ref is what lets the earlier callback
   * reach the later one without reordering the whole component.
   */
  const sendRequestRef = useRef<() => void>(() => {})

  // Follow the conversation as it grows, but never fight a customer who has
  // scrolled up to re-read what she wrote.
  useEffect(() => {
    const el = transcriptRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [bubbles])

  const send = useCallback(
    async (text: string, options: { requestHuman?: boolean } = {}) => {
      const requestHuman = options.requestHuman === true
      if (!text.trim() && !requestHuman) return

      setFailed(false)
      setBusy(true)
      lastSent.current = text

      if (text.trim()) {
        setBubbles((prev) => [
          ...prev,
          { id: `c_${Date.now()}`, author: 'customer', text },
        ])
      }

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const response = await fetch(`/api/chat/${props.slug}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            turnId: crypto.randomUUID(),
            text,
            honeypot,
            timeToSubmitMs: Date.now() - renderedAt.current,
            requestHuman,
            clientSentAt: new Date().toISOString(),
          }),
        })

        if (!response.ok || !response.body) throw new Error(`status ${response.status}`)
        await consumeStream(
          response.body,
          setBubbles,
          () => setCanSend(true),
          () => sendRequestRef.current(),
        )
      } catch (error) {
        // An abort is the customer interrupting on purpose (F1.14). It is not a
        // failure and must not surface as one.
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setFailed(true)
        }
      } finally {
        setBusy(false)
        abortRef.current = null
        renderedAt.current = Date.now()
      }
    },
    [honeypot, props.slug],
  )

  /**
   * F1.14 / Invariant 5 — pause automation immediately.
   *
   * The in-flight stream is aborted first, before the network call that records the
   * intervention. The customer asked for a person; the agent stops talking now, not
   * when the server gets around to agreeing.
   */
  const requestHuman = useCallback(() => {
    abortRef.current?.abort()
    setPaused(true)
    setBubbles((prev) => [
      ...prev,
      {
        id: `h_${Date.now()}`,
        author: 'agent',
        variant: 'paused',
        text: humanRequestedNotice(props.language, props.formality, props.ownerName),
      },
    ])
    void send('', { requestHuman: true })
  }, [props.formality, props.language, props.ownerName, send])

  /**
   * Phase D — hand the request to the caterer.
   *
   * Hers to press, and only hers. The assistant asks and summarises; it never
   * decides that an enquiry is finished. Nothing priced and nothing binding
   * exists on the other side of this button (I3).
   */
  const sendRequest = useCallback(async () => {
    setSendFailed(false)
    setSending(true)
    try {
      const response = await fetch(`/api/chat/${props.slug}/send`, { method: 'POST' })
      if (!response.ok) throw new Error(`status ${response.status}`)
      const body = (await response.json()) as { url?: string; alreadySent?: boolean }
      // A second press is the same send. She still lands on "it is on its way",
      // because from where she is sitting that is exactly what happened.
      setSentUrl(body.url ?? '')
      setCanSend(false)
    } catch {
      setSendFailed(true)
    } finally {
      setSending(false)
    }
  }, [props.slug])

  useEffect(() => {
    sendRequestRef.current = () => void sendRequest()
  }, [sendRequest])

  const started = bubbles.length > 0

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        {props.logoUrl ? (
          // A plain img, not next/image: the latter would need a loader and a
          // remote pattern for arbitrary agency logo hosts, and the CSP on this
          // surface admits no external origin anyway (F1.12).
          <img className={styles.logo} src={props.logoUrl} alt="" width={36} height={36} />
        ) : (
          <div className={`${styles.logo} ${styles.logoFallback}`} aria-hidden="true">
            {props.agencyName.slice(0, 1)}
          </div>
        )}

        <div className={styles.identity}>
          <div className={styles.agencyName}>{props.agencyName}</div>
          {/* F1.8 — persistent, for the whole conversation, not a line that
              scrolls away. */}
          <div className={styles.aiLabel}>
            <span className={styles.aiDot} aria-hidden="true" />
            {disclosure.headerLabel}
          </div>
        </div>

        {/* F1.14 — advertised on every turn, never behind a menu. */}
        <button
          type="button"
          className={styles.humanButton}
          onClick={requestHuman}
          disabled={paused}
        >
          {disclosure.requestHumanLabel}
        </button>
      </header>

      <div
        className={styles.transcript}
        ref={transcriptRef}
        role="log"
        aria-live="polite"
        aria-label={props.agencyName}
      >
        {!started && (
          <div className={styles.empty}>
            {/* S5 — the disclosure is on screen before the customer types a word.
                Art. 50(1) is about being told, not about being told eventually. */}
            <h1 className={styles.emptyTitle}>{strings.emptyTitle}</h1>
            <p className={styles.emptyBody}>{strings.emptyBody}</p>
            <p className={`${styles.bubble} ${styles.notice} ${styles.noticeStrong}`}>
              {disclosure.openingLine}
            </p>
            <p className={`${styles.bubble} ${styles.notice}`}>
              {/* F1.13 — Art. 13 privacy link at first contact. */}
              <a href={props.privacyNoticeUrl}>{disclosure.privacyLine}</a>
            </p>
          </div>
        )}

        {bubbles.map((bubble) => (
          <div
            key={bubble.id}
            className={[
              styles.bubble,
              bubble.author === 'agent' ? styles.fromAgent : styles.fromCustomer,
              bubble.variant === 'notice' ? styles.notice : '',
              bubble.variant === 'paused' ? styles.paused : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {bubble.text}
            {bubble.streaming && <span className={styles.cursor}>▍</span>}
          </div>
        ))}

        {busy && !bubbles.some((b) => b.streaming) && (
          // F1.7 — never a blank wait.
          <div className={styles.typing} aria-label={strings.typing}>
            <span className={styles.typingDot} />
            <span className={styles.typingDot} />
            <span className={styles.typingDot} />
          </div>
        )}

        {failed && (
          // S8. The message is kept and offered back — a customer must never lose
          // what she typed because our endpoint had a bad minute.
          <div className={styles.error} role="alert">
            <strong className={styles.errorTitle}>{strings.errorTitle}</strong>
            {strings.errorBody}
            <div>
              <button
                type="button"
                className={styles.retry}
                onClick={() => void send(lastSent.current)}
              >
                {strings.retry}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Phase D — the send control. It appears when the request is complete
          enough to be useful and never blocks her before that: the composer stays
          open either way, and nothing here can tell her she may not send. */}
      {sentUrl !== null ? (
        <div className={styles.sent} role="status">
          <strong className={styles.sentTitle}>{strings.sentTitle}</strong>
          <span>{strings.sentBody}</span>
          {sentUrl ? (
            <a className={styles.sentLink} href={sentUrl}>
              {strings.viewSummary}
            </a>
          ) : null}
        </div>
      ) : canSend && !paused ? (
        <div className={styles.sendPanel}>
          <button
            type="button"
            className={styles.sendRequest}
            onClick={() => void sendRequest()}
            disabled={sending}
          >
            {sending ? strings.sending : strings.sendRequest}
          </button>
          <span className={styles.sendHint}>
            {sendFailed ? strings.sendFailed : strings.sendHint}
          </span>
        </div>
      ) : null}

      <form
        className={styles.composer}
        onSubmit={(e) => {
          e.preventDefault()
          const text = draft
          setDraft('')
          void send(text)
        }}
      >
        {/* F1.11 — honeypot. Hidden from people and assistive technology; a
            form-filling bot fills everything it finds. No CAPTCHA, because a
            CAPTCHA is a third-party script and would break F1.12. */}
        <label className={styles.honeypot} aria-hidden="true">
          Website
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </label>

        <label className="sr-only" htmlFor="chat-input">
          {strings.inputLabel}
        </label>
        <textarea
          id="chat-input"
          className={styles.input}
          rows={1}
          value={draft}
          placeholder={strings.inputPlaceholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line — the convention every
            // messaging app this customer already uses follows.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              const text = draft
              setDraft('')
              void send(text)
            }
          }}
        />

        <button type="submit" className={styles.send} disabled={busy || !draft.trim()}>
          {busy ? strings.sending : strings.send}
        </button>
      </form>

      <footer className={styles.footer}>
        <a href={props.privacyNoticeUrl}>{strings.privacy}</a>
        <a href={props.imprintUrl}>{strings.imprint}</a>
        <span>{disclosure.headerLabel}</span>
      </footer>
    </div>
  )
}

/**
 * Read the SSE stream and append text as it arrives.
 *
 * Hand-parsed rather than using `EventSource`, which only does GET and could not
 * carry the message body. Frames are separated by a blank line and may be split
 * across network chunks, so the tail of an incomplete frame is carried forward.
 */
async function consumeStream(
  body: ReadableStream<Uint8Array>,
  setBubbles: React.Dispatch<React.SetStateAction<Bubble[]>>,
  onReady?: () => void,
  onSendNow?: () => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let currentId: string | null = null

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const frames = buffer.split('\n\n')
    // The last element is whatever arrived after the final blank line — an
    // incomplete frame. Keep it for the next read.
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const eventLine = frame.split('\n').find((l) => l.startsWith('event: '))
      const dataLine = frame.split('\n').find((l) => l.startsWith('data: '))
      if (!eventLine || !dataLine) continue

      const event = eventLine.slice(7).trim()
      let data: { kind?: string; text?: string }
      try {
        data = JSON.parse(dataLine.slice(6)) as { kind?: string; text?: string }
      } catch {
        continue
      }

      if (event === 'turn') {
        const id = `a_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
        currentId = id
        const variant =
          data.kind === 'disclosure' || data.kind === 'privacy'
            ? ('notice' as const)
            : data.kind === 'paused'
              ? ('paused' as const)
              : undefined
        setBubbles((prev) => [
          ...prev,
          { id, author: 'agent', text: '', streaming: true, ...(variant ? { variant } : {}) },
        ])
      } else if (event === 'chunk' && currentId) {
        const id = currentId
        const text = data.text ?? ''
        setBubbles((prev) =>
          prev.map((b) => (b.id === id ? { ...b, text: b.text + text } : b)),
        )
      } else if (event === 'turn_end' && currentId) {
        const id = currentId
        setBubbles((prev) => prev.map((b) => (b.id === id ? { ...b, streaming: false } : b)))
        currentId = null
      } else if (event === 'ready') {
        // Not a turn: the assistant did not say this. The server computed that the
        // request is complete enough to hand over, and the control appears.
        onReady?.()
      } else if (event === 'send_now') {
        // A1 — she answered the summary with a yes rather than reaching for the
        // button. Same button, pressed for her: this calls the identical endpoint
        // with her session cookie, so nothing here is a second way to send.
        onSendNow?.()
      }
    }
  }

  // A stream that ends mid-turn must not leave a caret blinking forever.
  setBubbles((prev) => prev.map((b) => (b.streaming ? { ...b, streaming: false } : b)))
}
