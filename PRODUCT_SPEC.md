# PRODUCT_SPEC.md — Full Product Specification (rev. 3)

**Working title:** OfferPing / EventSnap / AngebotBot *(undecided)*
**Status:** Specification — ready for implementation planning
**Date:** 2026-08-08 (rev. 3 — committed multi-channel roadmap, Slack, Gmail interim path)
**Standing context:** [CLAUDE.md](CLAUDE.md) · **Source record:** [docs/ORIGINAL_BRIEF.md](docs/ORIGINAL_BRIEF.md)
**Market:** DACH, German-language primary
**Source:** German concept brief (08.08.2026) + structured requirements interview

---

## 0. One-paragraph summary

Small event agencies (1–5 people) run their entire pre-sale over WhatsApp and email, but the moment a quote is needed they break out into Word, Excel or Canva — losing 30–60 minutes per quote and, frequently, the deal, because customers ask 3–5 agencies at once and the fastest credible quote usually wins. This product closes that gap: an inquiry arrives, is acknowledged within seconds, is parsed by AI into structured event data, is priced **deterministically** against the agency's own uploaded catalogue, and becomes a branded quote. The agent then **iterates directly with the end customer** — adjusting scope until they're satisfied — inside hard guardrails it may never cross. When the customer explicitly accepts, a fully qualified request lands on the owner's dashboard. The owner enters **after** agreement, to confirm and fulfil, not to type documents.

**Rev. 2 changed the delivery vehicle, not the product.** The negotiation runs in a **hosted, branded chat we own**, reached by a link the agency puts in its Instagram bio, website and email signature. That single decision removes every external approval from the critical path: no Meta review, no Google CASA, no message templates, no 24-hour window.

**Rev. 3 makes the endpoint explicit.** WhatsApp and Gmail ingestion are **committed requirements of the final product**, not optional upgrades — the external verifications must come through, they simply do not gate launch. Slack joins as an owner-side surface. The hosted chat is the launch vehicle; the destination is genuinely multi-channel, with every channel behind the same intake contract (§4.9).

---

## 1. Decisions log (locked)

| # | Decision | Choice | Consequence |
|---|---|---|---|
| D1 | **Launch channels** | **Hosted chat (primary) + email via forwarding alias + paste/forward-in.** WhatsApp, Gmail OAuth and Slack are **committed roadmap requirements**, sequenced after launch | *Revised rev. 2 and rev. 3.* Zero external approvals on the critical path; multi-channel is the destination |
| D2 | Core output | Branded quote (Angebot) | Not a scheduling product; calendar is a constraint input |
| D3 | Autonomy | Full auto for standard cases; human on low-confidence | Confidence model + guardrail engine are first-class |
| D4 | Agency onboarding intake | Bulk folder upload + website crawl + **mandatory past quotes** | Multi-format ingestion at onboarding, not just at inquiry time |
| D5 | Customer input types | Text, chat transcripts, pasted text files, images/screenshots, documents. **Voice notes out of MVP** | Vision + document extraction in v1; no STT dependency |
| D6 | Pricing | **Deterministic rules over the catalogue.** AI maps intent → items; AI never does arithmetic | Auditable prices; prerequisite for D3 and for D22 |
| D7 | Negotiation model | Agent iterates with the end customer, then hands a formal request to the owner | Owner enters after agreement |
| D8 | Guardrails | Catalogue prices only, hard per-item floor. No invented services, no discounts | Violations pause the conversation and ping the owner |
| D9 | Legal status of the document | **Non-binding (freibleibend), owner confirms** | Contract forms on owner confirmation only |
| D10 | Handoff trigger | Explicit "Angebot annehmen" click on the tokenised quote | Timestamped, auditable, no model-inferred acceptance |
| D11 | Roles | Owner + optional teammates; customer has no account, only tokenised links | Multi-tenant with RLS |
| D12 | **WhatsApp** | Meta Cloud API direct. **Deferred from launch, required in the final product** | Removed from critical path; verification track starts day 1 |
| D13 | **Email** | Forwarding alias + own sending domain at launch. **Gmail OAuth required in the final product** | Alias works with Gmail, Outlook, IONOS, Strato — closes old open question #8 |
| D14 | Availability | Calendar-aware quoting (read-only Google/Outlook) | Date conflicts resolved before a price is quoted |
| D15 | Stack | Next.js + Supabase, EU region (Frankfurt) | TS end-to-end, Postgres + RLS, Storage, pgvector |
| D16 | Vertical | Event agencies only | No premature abstraction |
| D17 | AI processing | Claude API under DPA, no training, zero-retention where available | Named sub-processor in each agency's GDPR record |
| D18 | Follow-up | Two auto nudges (~48h, ~5d), then owner task | On hosted chat + email: no template approval needed |
| D19 | Language | DE + EN, mirror the customer; Sie/Du mirrored | Doubles prompt/template test matrix |
| D20 | Deliverable of this phase | This spec document | Implementation plan follows |
| **D21** | **Critical path** | **Technical only. No feature ships on the far side of a third-party review** | External approvals run as a parallel, non-blocking track (§13) |
| **D22** | **GDPR Art. 22** | **Complete exclusion by design, not mitigation** | Six binding invariants in §12.6 — these override all other requirements |
| **D23** | **Automated adverse decisions** | **Never.** The system may only produce an offer or hand off to a human | *Overrides* the old auto-decline behaviour in §6 |
| **D24** | **Pricing inputs** | **No personal data may reach the pricing engine.** Event attributes only | Enforced by the input schema, not by convention |
| **D25** | **AI Act Art. 50 disclosure** | Mandatory, live since 2026-08-02 | Customer is told they're talking to an AI, in-chat and on the quote |
| **D26** | **Monetisation** | Stripe subscription, paywall from day one | Test mode from minute one; activation is days, not weeks |
| **D27** | **Slack** | **Owner-side surface** — escalations, one-tap approve/decline, team coordination. Interim while WhatsApp is pending, and valuable permanently | Not a customer intake channel (§4.5.3). Single-workspace install needs no Slack review |
| **D28** | **Gmail interim path** | Testing-mode OAuth with 7-day re-auth **accepted by owner**, forwarding alias live underneath as permanent fallback | An expired token degrades the channel instead of silently dropping inquiries |

---

## 2. Users and what each of them puts into the system

### 2.1 The agency owner (primary user, tenant admin)
Non-technical, time-poor, runs the business from a phone. Sets up the account, uploads the onboarding folder, confirms the extracted catalogue, sets guardrails, confirms accepted requests.
**Trust level:** authoritative. Owner input overrides all extraction.

### 2.2 The agency teammate (0–4 per tenant)
Same surfaces minus billing, channel connections and guardrail configuration.

### 2.3 The end customer (no account)
Chats in the hosted chat or by email, uploads images/documents, fills the detail form, interacts with the quote link.
**Trust level: untrusted input.** Never instructions to the system (§12.4).

### 2.4 External systems
Inbound email webhooks, calendar providers. Verified; payloads are data.

---

## 3. End-to-end flow

```
[1] INQUIRY ARRIVES     hosted chat link  |  email to alias  |  owner pastes/forwards a WhatsApp thread
         │
[2] AI DISCLOSURE       first assistant turn identifies itself as an AI (D25, mandatory)
         │
[3] INSTANT ACK         < 10s, same channel, customer's language
         │
[4] NORMALISE           → canonical InboundEvent envelope (§4.9)
         │
[5] EXTRACT             Claude structured extraction → EventBrief + per-field confidence
         │
[6] GAP CHECK           missing required fields → quick-reply chips in chat / reply-parsed questions by email
         │               detail-level gaps → optional form, positioned as added value
         │
[7] AVAILABILITY        calendar check → free / conflict / peak / below lead time
         │               ⚠ a conflict NEVER auto-declines (D23) — it routes to the owner with alternatives
         │
[8] PRICE               deterministic engine over catalogue → QuoteDraft
         │               ⚠ receives event attributes only, never personal data (D24)
         │
[9] GUARDRAIL GATE      within envelope? ──no──> ESCALATE to owner, conversation pauses
         │ yes
[10] RENDER + SEND      branded PDF + tokenised web quote, on the origin channel
         │
[11] NEGOTIATION LOOP   customer asks for changes → re-extract → re-price → new version
         │               (loops until acceptance, human handoff, expiry, or escalation)
         │
[12] ACCEPTANCE         customer clicks "Angebot annehmen"
         │
[13] HANDOFF            qualified request appears on owner dashboard
         │
[14] OWNER CONFIRMS     contract forms HERE (D9). Calendar event created.
         │
[15] FOLLOW-THROUGH     fulfilment task list; Lexware/sevdesk export (post-MVP)
```

### 3.1 Inquiry state machine

```
new → acknowledged → extracting → qualifying → priced → quote_sent
        ↓                              ↓            ↓         ↓
   escalated ←──────────────────────────────────────┘    negotiating
        ↓                                                     ↓
   owner_handling                                        accepted → confirmed → fulfilled
        ↓                                                     ↓
      (any) → declined_by_customer | expired | spam | archived
```

Note there is no `declined_by_system` state. That is deliberate and load-bearing — see D23 and §12.6.

Every transition writes an `audit_log` row with actor (`system` | `agent` | `user:<id>` | `customer`), timestamp, reason.

---

## 4. Data ingestion — the complete picture

### 4.1 Agency onboarding ingestion (D4)

**Goal:** the owner drops in material they *already have* — no manual catalogue building.

#### 4.1.1 Accepted inputs

| Input | Formats | Required | Purpose |
|---|---|---|---|
| Past quotes | PDF, DOCX, Canva export, photos of quotes | **Mandatory, min. 3** | Line items, prices, service wording, structure, house voice |
| Brand assets | PNG, SVG, JPG, PDF letterhead | Optional | Logo, colours, fonts |
| Price lists | XLSX, CSV, PDF | Optional | Direct catalogue seeding |
| Terms / AGB | PDF, DOCX | Optional | Attached to quotes |
| Website URL | URL | Optional | Services, packages, published prices, tone |
| Reference material | Any of the above, bulk | Optional | Extra context |

**Bulk upload:** folder drag-and-drop, up to 50 files / 200 MB per tenant. Files land in Supabase Storage under `tenant/{agency_id}/onboarding/`, one `onboarding_assets` row each, processed asynchronously with per-file progress.

#### 4.1.2 Website crawl rules
Owner-supplied URL only. Same registrable domain, max 40 pages, depth 3, respects `robots.txt`, 10s per-page timeout. Prioritised paths: `/leistungen`, `/preise`, `/pakete`, `/angebot`, `/services`, `/pricing`, `/ueber-uns`. Extracted content is **candidate** data only.

#### 4.1.3 Extraction → confirmation (never silent)
The onboarding agent produces three candidate objects:

1. **BrandProfile** — logo, primary/secondary colour, font guess, letterhead layout, footer/legal block, house-voice sample.
2. **ServiceCatalogue** — candidate `catalog_items` with name, description, unit, unit price, VAT rate, and a **frequency score** (how many uploaded quotes contained it).
3. **QuotePattern** — section order, intro/outro text, terms wording, validity period, payment terms.

Every candidate carries `confidence` and `source_refs` (asset id + page + text span). The owner confirms, edits or rejects **per object**. Nothing enters the live catalogue unconfirmed; rejections are kept as negative signal.

**Exit criterion for onboarding:** ≥ 5 confirmed catalog items, ≥ 1 price rule each, brand profile confirmed, guardrails set.

#### 4.1.4 House voice
Derived from confirmed past quotes; stored as a short style descriptor plus 3–5 verbatim excerpts used as bounded few-shot examples. Never a free-running "imitate the agency" instruction.

---

### 4.2 Channel — Hosted Angebots-Chat (primary, zero external dependency)

This replaces WhatsApp as the launch surface and is why §13 has no blocking dependencies.

#### 4.2.1 How the customer gets there
- **Link in bio** — `chat.ourdomain.de/a/{agency-slug}`, branded with the agency's logo and colours. The brief states this segment acquires via Instagram and Google; the bio link is where that traffic already goes.
- **Website embed** — a one-line `<script>` snippet or an `<iframe>` for a "Angebot anfragen" button.
- **QR code** — generated per agency for print, fairs, business cards.
- **Google Business Profile** link.
- **Owner forward** — a customer messages the agency's WhatsApp; the owner taps one button and sends the link with a prefilled `wa.me` deep link. Requires no Meta integration whatsoever, and moves the thread onto our surface in one tap.

#### 4.2.2 Why this is technically superior to messenger for the agent loop
| Constraint | WhatsApp Cloud API | Hosted chat |
|---|---|---|
| Re-engagement outside 24h | Approved templates only | No restriction |
| Message content | Template-bound, category-reviewed | Free |
| Rich UI (option cards, price breakdown, comparison) | Text + limited interactive | Full web UI |
| Attachments | Media API, expiring URLs | Direct upload |
| Approval to launch | Business verification + App Review | None |
| Message cost | Per-conversation fee | Zero |
| Rate limits | Messaging tiers | Ours |
| Typing/streaming feedback | None | Yes |

#### 4.2.3 Technical shape
- Next.js route `/a/{slug}` — server-rendered, mobile-first, no login.
- Session identified by a signed, HTTP-only cookie plus a resumable link token, so a customer can close the tab and return. **Essential-only cookie — no analytics, no third-party scripts, therefore no consent banner required under TDDDG §25.**
- Realtime via Supabase Realtime or SSE; agent responses stream.
- Uploads go straight to Supabase Storage with a signed URL, scanned before processing.
- Email capture is asked for early but is **not** a wall — the customer can converse first. Contact details are required only before the quote is issued.
- Every turn emits an InboundEvent (§4.9) with `channel: "hosted_chat"`.

#### 4.2.4 Abuse controls (ours, not a platform's)
Per-IP and per-session rate limits, invisible timing/honeypot checks rather than a CAPTCHA, max 10 uploads and 25 MB per file, per-agency daily inquiry cap with owner alerting, and a spam classifier that routes to a tray — never auto-rejects (D23).

---

### 4.3 Channel — Email via forwarding alias (D13, zero external dependency)

#### 4.3.1 Inbound
- Each tenant gets `anfragen-{slug}@in.ourdomain.de`.
- The owner sets **one forwarding rule** in whatever mail client they already use — Gmail, Outlook, IONOS, Strato, GMX. This is a two-minute setting change, no OAuth, no app passwords, no credential storage, and it works for the whole DACH provider mix rather than Gmail alone.
- Receiving: **Cloudflare Email Routing → Email Worker** (instant to set up, free, DNS-only, 25 MB per message) posting to `/api/webhooks/email-in`. Postmark or SES inbound are drop-in alternatives behind the same handler.
- Parse MIME: headers, `text/plain` preferred, sanitised HTML fallback, attachments extracted, `Message-ID`/`In-Reply-To`/`References` used for thread identity.
- **We only ever receive what the agency chooses to forward.** We never hold access to their mailbox. This is a materially smaller data footprint than Gmail OAuth and a much easier privacy conversation with their corporate clients.

#### 4.3.2 Outbound
- Default: send from `{agency-slug}@mail.ourdomain.de`, `From` display name = the agency, `Reply-To` = the agency's real address. **Zero setup for the owner.**
- Upgrade (optional, self-serve): the agency verifies its own domain by adding a DKIM CNAME and an SPF include, then mail sends as `info@theiragency.de`. A guided wizard with copy-paste records and live verification polling. DNS is under the agency's control — no third-party approval.
- DMARC-aligned, dedicated sending subdomain, gradual warm-up, bounce/complaint webhooks → `delivery_failed` surfaced to the owner.

#### 4.3.3 Inquiry filter
Not everything forwarded is an inquiry. A cheap classifier gate runs before expensive extraction: drop newsletters (`List-Unsubscribe`, `Precedence: bulk`), no-reply senders, internal threads. Unclear cases go to a "possible inquiry" tray — **never silently auto-answered, never auto-rejected.**

---

### 4.4 Channel — Paste-in / forward-in (covers WhatsApp on day one)

The pragmatic bridge until a messenger adapter exists, and useful permanently.

- **Paste a conversation** — the owner pastes a WhatsApp chat export or any text into the dashboard; it is parsed into speaker turns and creates an inquiry.
- **Forward an email** — forwarding to the alias works for anything already in their inbox.
- **PWA Share Target (Android)** — the app registers as a Web Share Target, so the owner uses WhatsApp's native *Share* on a chat or message and picks our app. This is genuinely one tap, fully compliant, and involves Meta not at all. iOS falls back to copy-paste.
- Output of all three: an inquiry that runs the full engine. The reply goes back via the hosted chat link or email.

**Honest limitation:** this is not the "never leave WhatsApp" experience the original brief pitched. It is one tap of owner effort per inquiry, in exchange for shipping months earlier with no platform risk. The negotiation loop — the actual product — runs unchanged.

---

### 4.5 Channels — committed roadmap (D1, D12, D13, D27, D28)

These are **requirements of the final product**, not optional extras. Each is one adapter emitting the §4.9 envelope; nothing downstream changes when any of them lands. External verification for all three starts on day 1 and runs in parallel (§13.2).

#### 4.5.1 Slack — owner-side (D27), first to land

**Direction of the integration matters.** Slack is where the *agency team* works, not where customers are. Wedding customers are not on Slack, and corporate clients will not install a vendor's app into their workspace to request a quote. Built the other way round, it is genuinely useful and lands fastest of the three.

- **Escalation alerts** — a guardrail hit or human-request lands in a channel with the customer's message, the EventBrief and the reason.
- **One-tap actions** — Approve send · Confirm booking · Take over. Slack Block Kit interactive buttons hitting the same authenticated endpoints as the dashboard, with the acting user resolved from the Slack identity mapping.
- **Team coordination** — new inquiries and accepted quotes posted to a channel, so Markus's 3-person team sees pipeline without everyone logging in.
- **Daily digest** — overdue SLA items each morning.

**Gate:** none for the launch shape. A "Add to Slack" OAuth install into a single workspace needs no Slack review; only public App Directory listing does, and that is a marketing decision for later. Scopes: `chat:write`, `commands`, `users:read`. No message-reading scopes — we never read the agency's Slack conversations.

**Optional later:** Slack Connect intake for corporate clients who already share a channel with the agency. Low priority — it serves Markus's segment only and will not move the numbers.

#### 4.5.2 Gmail OAuth (D13, D28)

Target: `gmail.readonly` (or `gmail.modify`) + `gmail.send`, threads preserved natively, zero setup for the owner.

**Interim path, accepted by the owner:** ship on testing-mode OAuth while CASA runs — ≤100 users, and Google invalidates refresh tokens every 7 days, so each owner re-authorises weekly through an "unverified app" warning screen.

**Required mitigation, non-negotiable:** the forwarding alias (§4.3) stays connected underneath for every tenant that enables OAuth. Duplicate suppression runs on `Message-ID`, so a message arriving by both paths creates one inquiry. When a token expires, the channel degrades to the alias rather than going dark, and the owner is notified with a one-tap reconnect at 24h before expiry and again on expiry. **A dead token must never silently drop a customer's reply** — that is the precise failure the product exists to prevent, and it would be worse than having no OAuth at all.

Once verification clears, the 100-user cap and 7-day expiry both disappear and this becomes an ordinary integration. Note the **annual** CASA re-assessment as a recurring calendar item, not a one-off.

#### 4.5.3 WhatsApp Cloud API (D12), last to land

Target: Meta Cloud API direct, Embedded Signup **v4** (v2 deprecated 15 Oct 2026), six utility templates (`inquiry_ack`, `quote_ready`, `quote_reminder_1`, `quote_reminder_2`, `quote_expiring`, `owner_handover`) in DE + EN, 24-hour-window logic, opt-in evidence capture, `X-Hub-Signature-256` verification, idempotency on `message.id`, media fetched immediately because URLs expire.

Sequenced last because it carries the heaviest gate (Tech Provider status + App Review) and the most restrictions (templates, 24h window, per-conversation fees) — while the hosted chat already delivers the same negotiation loop with none of them. Its value is meeting the customer where they already are, which matters for conversion, not capability. Open question #6 measures how much.

**Explicitly not planned:** unofficial WhatsApp automation libraries. They violate Meta's terms and risk a ban on the agency's own business number — the number their livelihood runs through. Not a risk to take with a customer's asset, at any speed.

---

### 4.6 Customer content ingestion (D5)

| Type | Handling | Notes |
|---|---|---|
| Free text | Direct to extractor | Multi-turn, messy, mixed DE/EN |
| Pasted text / .txt | UTF-8, capped 256 KB | Pasted briefs |
| Chat transcripts | Parsed into speaker turns first | WhatsApp exports |
| Images / screenshots | Claude vision → description + fields | Mood boards, venues, competitor quotes, handwritten notes |
| PDF | Text layer; OCR fallback for scans | Corporate briefings, RFPs |
| DOCX / XLSX | Native parse to text/tables | Guest lists, requirement tables |
| Voice notes | **v1: stored and flagged, not transcribed** | Inquiry routes to owner. Envelope already carries the type, so v2 is additive |

**Hard limits:** 25 MB per file, 10 files per inquiry, MIME allowlist by content sniffing (not extension), malware scan before processing, sandboxed parsing workers.

---

### 4.7 Structured customer input — the detail form

Tokenised, mobile-first, linked from the conversation. Stage-2 detail only; critical qualifying fields are always asked in-conversation while the customer is warm.

- Token: single-inquiry scoped, 128-bit, expires with quote validity, revocable.
- Fields **generated from the gaps** in the EventBrief — never re-asks what the customer already said.
- Autosaves per field; partial submissions ingested.
- Each submitted field writes an `extraction` row with `source = 'form'`, `confidence = 1.0`, overriding AI values for the same field.

---

### 4.8 Calendar ingestion (D14)

- Google Calendar and Microsoft Graph, **read-only** during negotiation (`calendar.readonly` / `Calendars.Read`). These are *sensitive* scopes, not *restricted* — no CASA required. Google verification for sensitive scopes is a review measured in days, and the product functions fully without a calendar connected, so it is not on the critical path.
- Incremental sync (sync tokens / delta links), webhook-refreshed where available, otherwise every 15 min.
- Stored as a **busy/free cache only** — start, end, all-day, calendar id, `is_blocking`. **No event titles, attendees, descriptions or locations are stored.** Minimal footprint, defensible permission ask.
- Owner also maintains: capacity per day, blackout ranges, peak-season ranges, minimum lead time.
- Write access requested separately, only at step 14, to create the confirmed event.

**Outcomes feeding pricing:** `available` | `capacity_reached` | `hard_conflict` | `peak_season` | `below_lead_time`. Per D23, the last three **never** auto-decline: they produce alternatives plus an owner escalation.

---

### 4.9 The canonical inbound envelope

Everything converges here. **No downstream component ever reads a channel-native payload.**

```jsonc
{
  "event_id": "uuid",
  "agency_id": "uuid",
  "channel": "hosted_chat" | "email" | "paste_in" | "web_form" | "whatsapp",
  "direction": "inbound",
  "external_ids": {
    "message_id": "chat turn id | gmail Message-ID | wamid",
    "thread_id": "session id | gmail threadId"
  },
  "occurred_at": "2026-08-08T10:14:02Z",
  "received_at": "2026-08-08T10:14:03Z",
  "sender": {
    "display_name": "Lisa Meier",
    "email": "lisa@example.com",
    "phone_e164": null,
    "is_known_contact": true
  },
  "content": {
    "text": "Hallo, wir heiraten am 12.09.2027 ...",
    "language_detected": "de",
    "formality_detected": "du" | "sie" | "unknown",
    "quoted_reply_to": "external message id | null",
    "interactive": { "type": "chip_reply", "payload": "guests_50_100" }
  },
  "attachments": [
    {
      "attachment_id": "uuid",
      "kind": "image" | "document" | "audio" | "video" | "other",
      "mime": "application/pdf",
      "filename": "Briefing.pdf",
      "bytes": 184320,
      "sha256": "…",
      "storage_path": "tenant/…/inbound/…",
      "scan_status": "clean" | "pending" | "blocked"
    }
  ],
  "raw_payload_ref": "storage path to the untouched original",
  "idempotency_key": "channel:message_id"
}
```

**Rules:** idempotent on `idempotency_key`; raw payload archived unmodified for 30 days then deleted; a new channel is one adapter emitting this shape and nothing else changes.

---

### 4.10 Extraction output — the EventBrief

```jsonc
{
  "event_type":   { "value": "wedding",    "confidence": 0.95, "source": "msg_1" },
  "event_date":   { "value": "2027-09-12", "confidence": 0.99, "source": "msg_1" },
  "date_flexible":{ "value": false,        "confidence": 0.70 },
  "guest_count":  { "value": 85,           "confidence": 0.60, "source": "msg_3" },
  "location":     { "value": "Schloss Beispiel, Köln", "confidence": 0.80 },
  "budget_total": { "value": 12000, "currency": "EUR", "confidence": 0.50 },
  "services_requested": [
    { "value": "full_planning", "confidence": 0.90 },
    { "value": "decoration",    "confidence": 0.75 }
  ],
  "style_keywords": ["boho", "warm", "outdoor"],
  "duration_hours": { "value": 8, "confidence": 0.40 },
  "special_requirements": ["vegan catering", "barrier-free access"],
  "deadline_mentioned": { "value": "2026-08-15", "confidence": 0.80 },
  "competing_quotes_mentioned": true,
  "language": "de",
  "formality": "sie",

  // ── PII PARTITION ── never passed to the pricing engine (D24) ──
  "_contact": {
    "name": "…", "phone": "…", "email": "…", "role": "bride",
    "company": null, "vat_id": null
  },

  "_meta": {
    "extraction_version": "2026-08-08.2",
    "model": "claude-opus-5",
    "completeness": 0.72,
    "overall_confidence": 0.68
  }
}
```

**The `_contact` partition is structural, not stylistic.** The pricing function's parameter type does not include it, so personal data cannot reach pricing even by accident. This is the mechanism behind D24 and §12.6 invariant 2.

#### Required fields by event type (configurable per agency)
| Event type | Required to price |
|---|---|
| Wedding | date, guest_count, location (or region), services_requested |
| Corporate | date, guest_count, location, services_requested |
| Equipment rental | date, duration, delivery region, item selection |
| Birthday / private | date, guest_count, services_requested |

#### Confidence policy
| Condition | Behaviour |
|---|---|
| All required ≥ 0.8 and `overall_confidence` ≥ 0.75 | Auto-price and auto-send |
| Any required 0.5–0.8 | Ask a targeted confirming question, then proceed |
| Any required < 0.5 | Ask; never guess |
| Conflicting values | Latest customer statement wins; conflict shown in timeline |
| Owner- or form-supplied | Confidence 1.0, always wins |

---

## 5. The conversation agent

### 5.1 What it may do
Identify itself as an AI (D25), ask qualifying questions, explain services, propose catalogue-priced options, adjust scope, produce new quote versions, answer what's included, hand off to a human.

### 5.2 What it may never do (enforced in code, not prompt)
A deterministic evaluator runs on every outbound message and every quote version. Prompt instructions are a first line, not the control.

- Never quote a price not derived from the catalogue engine.
- Never go below `floor_price` on any line item.
- Never grant a discount of any kind.
- Never invent a service that is not a confirmed `catalog_item`.
- Never produce a total outside `[min_order_value, max_auto_quote_value]`.
- Never commit to a date marked `hard_conflict` or `capacity_reached`.
- Never accept the customer's framing of a price ("the other agency said €3,000") as a pricing input.
- Never send anything after `opt_out_at`.
- **Never refuse, reject, decline or turn away a customer (D23).** Not on budget, not on date, not on region, not on capacity, not on suspected spam. The only permitted outcomes are *an offer* or *a human takes over*.

**Violation → the message is not sent, the inquiry moves to `escalated`, the owner is notified in-app and by push** with the customer's request and the reason. The customer receives a neutral holding message ("Ich gebe das kurz an [Owner] weiter — Sie hören in Kürze."). The customer is never told a rule was hit.

### 5.3 Escalation triggers
Customer asks for a human · frustration, complaint or cancellation intent · corporate RFP with formal requirements · total above `max_auto_quote_value` (default €5,000) · more than `max_negotiation_rounds` without acceptance · any legal, contractual, insurance or liability question · suspected prompt injection · **any case that would otherwise be a refusal**.

### 5.4 Tone (D19)
Mirrors the customer's language and formality; overridable per agency. House voice from §4.1.4. Message caps: ≤ 600 characters per turn, max 2 consecutive turns then wait. Emojis only if the agency's own material uses them.

---

## 6. Guardrail configuration (owner-facing)

Set at onboarding, editable any time. Deliberately small — fillable in under three minutes by a non-technical owner.

| Setting | Default | Meaning |
|---|---|---|
| `floor_price` per item | = list price | Minimum the agent may quote |
| `min_order_value` | €0 | Below this → **escalate to owner** (never decline — D23) |
| `max_auto_quote_value` | €5,000 | Above this → owner approves before send |
| `allow_scope_reduction` | true | May the agent remove items to fit a budget |
| `max_negotiation_rounds` | 4 | Then escalate |
| `quote_validity_days` | 14 | Bindefrist on the document |
| `auto_send_enabled` | true | Master switch for D3 |
| `blackout_dates` | — | Never quoted; routed to owner with alternatives |
| `peak_season_ranges` + modifier | — | e.g. May–Sep +15% |
| `lead_time_min_days` | 14 | Below this → rush modifier or escalate |
| `capacity_per_day` | 1 | Parallel events the agency can run |
| `escalation_notify` | push + email | Where owner alerts go |

**Changed from rev. 1:** `min_order_value`, `blackout_dates` and `lead_time_min_days` previously triggered a polite automated decline. They now escalate. An automated refusal of service is the exact fact pattern GDPR Art. 22 was written for, and D22 requires it be impossible.

---

## 7. Pricing engine (D6 — deterministic)

### 7.1 Structure
```
Catalogue
 ├── catalog_items      name, description, unit, unit_price, floor_price, vat_rate, active
 ├── quantity_drivers   per_guest | per_hour | per_km | per_day | flat | per_item
 ├── packages           named bundles, optional bundle price
 ├── modifiers          weekend | peak_season | rush | travel_distance | overtime
 └── price_rules        tiered/Staffel pricing: quantity band → unit price
```

### 7.2 Input contract (D24)

```ts
type PricingInput = {
  eventType: EventType
  eventDate: ISODate
  guestCount: number
  durationHours: number
  distanceKm: number
  serviceIds: CatalogItemId[]
  packageIds: PackageId[]
  availability: AvailabilityOutcome
}
// There is deliberately no field for name, email, phone, company,
// address, VAT id, or any other attribute of a person.
// A reviewer can verify Art. 22 non-profiling by reading this type.
```

The function is pure: same input, same output, no I/O, no model call. Fully unit-testable, and the argument that no profiling occurs is a five-line type rather than a policy claim.

### 7.3 Calculation order (fixed, testable)
```
1. Resolve service selection    → catalog_items / packages   [AI maps intent; deterministic lookup]
2. Resolve quantities           → from EventBrief drivers
3. Apply price_rules            → tiered unit prices
4. Line subtotals               = quantity × resolved_unit_price
5. Apply modifiers              → ordered, each +% or +fixed, recorded individually
6. Sum → net
7. VAT per line (19% / 7% / 0% reverse charge for EU B2B with valid VAT ID)
8. Gross total
9. Guardrail check              → floors, min/max, availability
```

**The model's only role is step 1. All arithmetic is code.** Every quote stores its full calculation trace, so any number on any document can be reconstructed and defended.

### 7.4 Budget handling
If the computed total exceeds a stated budget: with `allow_scope_reduction`, the agent proposes a reduced-scope variant from catalogue items only, alongside the full variant. It never discounts, and it never tells the customer they cannot be served.

### 7.5 Rounding
EUR only in v1. Half-up to 2 decimals at line level; totals summed from rounded lines, matching German accounting software behaviour.

---

## 8. The quote document

### 8.1 Two representations, one source
- **Web quote** at `/q/{token}` — primary artefact. Responsive, branded, tracks views, carries accept/decline/comment. Every open writes a `quote_event`.
- **PDF** — server-rendered from the same data, attached to email. Content-identical.

### 8.2 Required content (DACH)
Agency legal name, address, contact, USt-IdNr. or Steuernummer, gapless quote number per tenant, issue date, **validity date**, customer details, itemised lines (quantity / unit / unit price / net), VAT breakdown per rate, gross total, payment terms, cancellation terms, AGB reference or attachment.

### 8.3 Legal framing (D9 + D25)

Non-removable on every quote:

> *„Dieses Angebot ist freibleibend und unverbindlich. Ein Vertrag kommt erst mit ausdrücklicher Bestätigung durch [Agency] zustande. Gültig bis TT.MM.JJJJ."*
>
> *„Dieses Angebot wurde mithilfe eines KI-Assistenten auf Basis Ihrer Angaben und der Preisliste von [Agency] erstellt und wird vor Bestätigung von [Agency] geprüft. Sie können jederzeit direkt mit [Agency] sprechen."*

The accept button reads **„Angebot annehmen"** with the sub-line *„Ihre Zusage — wir bestätigen Ihnen die Buchung verbindlich per E-Mail."* The customer's click is therefore an invitation to contract, not acceptance of a binding offer under §145 BGB.

The second paragraph does three jobs at once: AI Act Art. 50 transparency (D25), evidence that the process is not solely automated, and the standing human-intervention route. It is not optional copy.

### 8.4 Versioning
Each negotiation round creates an immutable `quote_version`. Prior versions stay reachable at their own token; the newest supersedes. Acceptance always references a specific version id.

---

## 9. Owner dashboard and handoff

### 9.1 Views
- **Inbox** — inquiries by state, SLA timer per row, overdue in red.
- **Needs you** — escalations, low-confidence extractions, accepted quotes awaiting confirmation. Default landing view; should be empty most days.
- **Inquiry detail** — full timeline (every message, extraction, quote version, guardrail check), EventBrief with source references, calendar status.
- **Catalogue** — items, price rules, packages, modifiers, floors.
- **Settings** — brand, channels, guardrails, team, billing.

### 9.2 The handoff object (D7/D10)
On acceptance the owner gets one card: customer contact, full EventBrief, accepted quote version with calculation trace, the entire transcript, calendar status, customer comments. One tap: **„Buchung bestätigen"** → confirmation sent on the origin channel, calendar event created, inquiry → `confirmed`.

The owner may also renegotiate or decline here without penalty — which is exactly what D9's non-binding framing preserves, and where any genuine refusal decision is made **by a human** (D23).

### 9.3 Follow-up (D18)
| When | Action |
|---|---|
| Quote sent, unopened after 48h | Nudge 1 |
| Opened, no response after 5d | Nudge 2 |
| 2 days before expiry | Expiry notice |
| After nudge 2 | Auto-nudges stop; task appears for the owner |
| Customer replies | All scheduled nudges cancelled immediately |
| `opt_out_at` set | All outbound blocked permanently |

Hard cap: 3 automated outbound messages after the quote. On hosted chat and email these are ordinary messages — **no template pre-approval, no 24-hour window**, which is a direct dividend of D1.

---

## 10. Data model (Postgres / Supabase)

Every tenant table has `agency_id uuid not null` with an RLS policy scoped to `agency_members`. Workers use the service role and must pass `agency_id` explicitly.

```
agencies              id, name, legal_name, address, tax_id, vat_id, plan, locale, created_at
users                 id (auth.users), email, name
agency_members        agency_id, user_id, role(owner|member), invited_at, accepted_at

channel_connections   id, agency_id, kind(hosted_chat|email_alias|sending_domain|google_cal|outlook_cal|whatsapp),
                      external_account_id, credentials_encrypted, scopes, status,
                      dns_verified_at, last_sync_token
agency_slugs          agency_id, slug UNIQUE, alias_email UNIQUE

onboarding_assets     id, agency_id, kind, filename, mime, bytes, sha256, storage_path,
                      processing_status, extracted_json, error
brand_profiles        agency_id, logo_asset_id, color_primary, color_secondary, font_family,
                      letterhead_json, voice_descriptor, voice_examples jsonb, confirmed_at

catalog_items         id, agency_id, name, description, unit, unit_price, floor_price, vat_rate,
                      quantity_driver, active, source_asset_ids, confirmed_by, confirmed_at
price_rules           id, catalog_item_id, min_qty, max_qty, unit_price
packages              id, agency_id, name, description, bundle_price_nullable
package_items         package_id, catalog_item_id, quantity
modifiers             id, agency_id, kind, condition_json, adjustment_type(pct|fixed), value, order_index
guardrails            agency_id, ...(§6 settings as columns)

contacts              id, agency_id, name, email, phone_e164, language, formality,
                      opt_in_source, opt_in_at, opt_out_at
inquiries             id, agency_id, contact_id, channel, external_thread_id, state,
                      first_message_at, acknowledged_at, sla_due_at, assigned_user_id,
                      escalation_reason, closed_reason
chat_sessions         id, agency_id, inquiry_id, session_token_hash, resumable_until, last_seen_at
messages              id, agency_id, inquiry_id, direction, channel, external_message_id UNIQUE,
                      body_text, interactive_json, status, error, raw_payload_ref,
                      sent_by(agent|user|system), created_at
attachments           id, agency_id, message_id, kind, mime, filename, bytes, sha256,
                      storage_path, scan_status, extracted_text
extractions           id, agency_id, inquiry_id, field_path, value_json, confidence,
                      source_message_id, source(ai|form|owner|customer_confirm), created_at
event_briefs          inquiry_id, brief_json, contact_json, completeness, overall_confidence, updated_at

availability_cache    id, agency_id, calendar_connection_id, starts_at, ends_at, all_day, is_blocking
blackout_dates        id, agency_id, starts_on, ends_on, reason
capacity_rules        agency_id, events_per_day, lead_time_min_days, peak_ranges jsonb

quotes                id, agency_id, inquiry_id, quote_number, current_version_id, state
quote_versions        id, quote_id, version_no, line_items jsonb, calculation_trace jsonb,
                      net_total, vat_breakdown jsonb, gross_total, valid_until,
                      pdf_path, token_hash, created_by(agent|user), created_at
quote_events          id, quote_version_id, type(sent|delivered|viewed|accepted|declined|commented|expired),
                      payload jsonb, ip_hash, user_agent_hash, occurred_at

agent_runs            id, agency_id, inquiry_id, purpose, model, input_ref, output_ref,
                      tokens_in, tokens_out, latency_ms, cost_cents, created_at
guardrail_checks      id, agent_run_id, rule, passed, details jsonb
escalations           id, agency_id, inquiry_id, reason, opened_at, resolved_at, resolved_by
human_interventions   id, agency_id, inquiry_id, trigger(customer_request|escalation|owner_initiated),
                      requested_at, responded_at, user_id      -- Art. 22 evidence trail
follow_up_jobs        id, agency_id, inquiry_id, kind, scheduled_for, state, attempts
subscriptions         agency_id, stripe_customer_id, stripe_subscription_id, plan, status,
                      quota_quotes_month, quotes_used_period, current_period_end
audit_log             id, agency_id, actor, action, entity, entity_id, diff jsonb, occurred_at
```

Indexes to specify up front: `messages(external_message_id)` unique for idempotency, `inquiries(agency_id, state, sla_due_at)` for the dashboard, `follow_up_jobs(state, scheduled_for)` for the worker, `attachments(sha256)` for dedupe, `agency_slugs(slug)` for the public chat route.

---

## 11. API surface

```
# Public, unauthenticated
GET  /a/{slug}                    hosted chat entry
POST /api/chat/{session}/message  customer turn (rate-limited)
POST /api/chat/{session}/upload   signed-URL issue
GET  /q/{token}                   quote view
POST /q/{token}/accept            explicit acceptance → handoff
POST /q/{token}/decline
POST /q/{token}/comment
POST /q/{token}/request-human     Art. 22 safeguard, always available
GET/POST /f/{token}               detail form

# Webhooks (verified)
POST /api/webhooks/email-in       Cloudflare Email Worker / Postmark inbound
POST /api/webhooks/email-status   bounces, complaints
POST /api/webhooks/calendar/google
POST /api/webhooks/stripe

# Owner app (session-authenticated, RLS-enforced)
GET/POST /api/inquiries                    list, filter
GET      /api/inquiries/{id}               full timeline
POST     /api/inquiries/{id}/reply         owner takes over
POST     /api/inquiries/{id}/confirm       booking confirmation — contract forms here
POST     /api/inquiries/{id}/decline       human decline (the ONLY decline path)
POST     /api/inquiries/paste              paste-in / share-target intake
POST     /api/quotes/{id}/versions         manual edit → new version
CRUD     /api/catalog/*
GET/PUT  /api/guardrails
POST     /api/onboarding/assets            bulk upload
POST     /api/onboarding/crawl
POST     /api/onboarding/confirm
POST     /api/channels/email/verify-domain DKIM/SPF wizard
GET      /api/billing/portal               Stripe customer portal

# Workers (queue-driven)
process_onboarding_asset · crawl_website · extract_brief · price_quote ·
render_quote · send_email · sync_calendar · run_follow_ups · enforce_quota
```

---

## 12. Security, tenancy and compliance

### 12.1 Multi-tenancy
Supabase RLS on every tenant table keyed on `agency_id` via `agency_members`. Storage paths tenant-prefixed with matching policies. **Every worker entry point asserts tenant scope as its first statement.** The public chat route resolves `slug → agency_id` server-side and never accepts an `agency_id` from the client.

### 12.2 Secrets
OAuth refresh tokens and sending credentials encrypted at rest via envelope encryption with the key in a managed KMS — not in the database, not in committed env files. Rotation and revocation on disconnect.

### 12.3 GDPR posture
- **Roles:** processor for end-customer data (agency is controller); controller for agency account data. Art. 28 DPA at signup. Sub-processors: Supabase (EU), Anthropic, Cloudflare, Stripe.
- **Residency:** Supabase EU (Frankfurt). Note honestly that Anthropic processes extraction content under DPA with no training use (D17).
- **Art. 13 duty:** first assistant turn and the chat footer link the agency's privacy notice — first contact is the correct moment.
- **Retention:** raw payloads 30 days; inquiry data default 24 months post-closure, agency-configurable; deletion within 30 days of request with audit trail.
- **Data subject requests:** per-contact export and delete, operable by the owner without us.
- **Cookies:** essential session cookie only, no analytics or third-party scripts on customer-facing surfaces → no TDDDG §25 consent banner required.
- **DPIA:** a documented threshold assessment is required. Because §12.6 removes Art. 22 applicability and no systematic evaluation with significant effects occurs, the expected conclusion is that no full DPIA is needed — but the screening must be written down, not assumed.

### 12.4 Prompt injection boundary
Customer messages, documents, images and crawled pages are **data, never instructions**.
- All customer-derived content is passed inside delimited, labelled blocks; the system prompt states it must not be followed as instruction.
- The pricing engine is the only thing that can set a price and reads only the catalogue — a model cannot emit a price into a document.
- Guardrail checks (§5.2) run deterministically on the output, after generation.
- Content attempting to instruct the system sets `injection_suspected` → escalate, never comply.

### 12.5 Uploads
MIME allowlist by content sniffing, size caps, malware scan before processing, no execution of uploaded content, PDFs parsed in a sandboxed worker.

### 12.6 GDPR Art. 22 — exclusion by design (D22)

**Requirement:** not "mitigated", not "arguable" — outside the article's scope entirely.

Art. 22(1) applies only when **both** conditions hold: the decision is based **solely** on automated processing, **and** it produces **legal effects** or **similarly significantly affects** the person. The design fails both, independently. Either alone would suffice; both are implemented so that no single design change can quietly bring the system into scope.

**Failing the "legal or significant effects" limb:**

> **Invariant 1 — no automated adverse decision, ever.**
> The system has exactly two possible outcomes for any inquiry: *an offer is produced*, or *a human takes over*. There is no code path by which software refuses, rejects, declines, deprioritises or turns away a customer — not for budget, date, capacity, region, or suspected spam. Enforced structurally: the inquiry state machine has no `declined_by_system` state, and the only decline endpoint (`POST /api/inquiries/{id}/decline`) requires an authenticated agency user.
>
> **Invariant 2 — no personal data in pricing, therefore no profiling.**
> The `PricingInput` type (§7.2) admits event attributes only. Name, contact, company, address and VAT id live in the `_contact` partition (§4.10) and are structurally unreachable from pricing. No price varies by any characteristic of a person. Special categories are never processed, so Art. 22(4) cannot engage.
>
> **Invariant 3 — nothing binding is produced automatically.**
> Every quote is `freibleibend` (§8.3). No contract, right or obligation arises from anything the agent does. The customer's legal position after an automated quote is identical to before it. The only act with legal effect is the owner's confirmation in §9.2, which is a human decision by a person with full authority and full information.

**Failing the "solely automated" limb:**

> **Invariant 4 — a human decision is always in the path to any outcome that matters.**
> Owner confirmation is mandatory, non-skippable, and the owner may renegotiate or decline at that point without penalty. Every escalation route (§5.3) hands a real decision to a person with authority and the complete record to decide on — the EDPB standard for meaningful, non-token human involvement.
>
> **Invariant 5 — human intervention is available on demand and advertised.**
> `POST /q/{token}/request-human` and a persistent "mit [Owner] sprechen" control appear in the chat, on the quote and in every email. Requesting a human immediately pauses automation and notifies the owner. Every request is logged in `human_interventions` as an evidence trail.
>
> **Invariant 6 — transparency, so no decision is opaque.**
> The customer is told at the first turn that they are talking to an AI assistant (D25, and independently mandatory under AI Act Art. 50 since 2026-08-02). The quote states it was AI-prepared, is subject to human confirmation, and how to reach a person (§8.3). On request, the calculation trace behind any figure can be shown — the deterministic engine (D6) means the logic is always explainable in plain language, which no model-priced system could offer.

**These six invariants outrank every other requirement in this document.** A future feature that would violate one — automatic rejection of low-budget leads, personalised pricing, binding instant booking, removing the human confirmation step — must be rejected at design time, not risk-assessed. Each invariant carries a corresponding test in the suite that must fail loudly if the behaviour regresses.

### 12.7 EU AI Act (D25)

- **Classification:** limited-risk. The system is not in an Annex III high-risk category — it touches no employment, credit, education, essential-services or biometric use case. The Digital Omnibus pushed Annex III obligations to **2 December 2027**; they do not apply here regardless.
- **Applicable now:** Article 50(1) transparency for direct human–AI interaction, **in application since 2 August 2026** — it was explicitly carved out of the Omnibus deferral and is enforceable by national market surveillance authorities today. Non-compliance exposure: up to €15M or 3% of worldwide turnover.
- **Implementation:** the first assistant turn discloses AI use in the customer's language; a persistent label sits in the chat header; the quote carries the §8.3 paragraph. Disclosure text is versioned and stored with each conversation so what was shown can be proven later.
- **Art. 50(2) marking of synthetic content** — machine-readable marking of AI-generated output. The quote PDF and web quote carry AI-generated metadata. Note the limited exception delaying marking obligations to 2 December 2026 for systems already on the market before 2 August 2026; a product launching after that date should simply implement it from the start.
- **Not applicable:** emotion recognition, biometric categorisation, deep fakes.

### 12.8 Other DACH obligations
- **UWG §7 / ePrivacy:** follow-ups (§9.3) are transactional continuations of a customer-initiated inquiry, not marketing. Any genuine marketing use would need separate opt-in and is out of scope.
- **§312g BGB withdrawal rights:** open question for counsel (§15) — likely excluded for date-specific event services under Abs. 2 Nr. 9, likely **not** excluded for standalone planning services. Must be resolved per service type before the first confirmation.
- **§14 UStG:** quote content requirements per §8.2; gapless numbering per tenant.

---

## 13. Dependencies — critical path is technical only (D21)

### 13.1 Critical path (all self-serve, no third-party review)

| Step | What | Time |
|---|---|---|
| 1 | GitHub repo, CI | Minutes |
| 2 | Supabase project, EU (Frankfurt) — Postgres, auth, storage, RLS | Minutes |
| 3 | Vercel project, custom domain, DNS | Minutes |
| 4 | Cloudflare domain + Email Routing → Email Worker (inbound mail) | Minutes, free |
| 5 | Anthropic API key | Minutes |
| 6 | Outbound email sender (Resend / Postmark / SES) | Hours — an ordinary vendor signup, not an audit |
| 7 | Stripe account + test mode | Build immediately; activation typically same-day |

**Nothing on this list is a review, an audit, or a permission.** From empty directory to a deployed, paywalled product, every gate is one you open yourself.

### 13.2 Parallel track — committed, started day 1, never blocking

Every item here **must land for the final product** (D1). None of them gates launch.

| Item | Time | Ships as | Why it is not blocking |
|---|---|---|---|
| **Slack app** (D27) | Days — no review for workspace install | Phase 10 | Owner-side only. Dashboard already covers every action Slack would surface |
| **Google CASA Tier 2 + OAuth verification** (D13, D28) | 4–12+ weeks, $540–1,000, **annual renewal** | Phase 11 | Email already works via forwarding alias. Interim testing-mode OAuth is accepted (≤100 users, 7-day re-auth), with the alias live underneath so an expired token degrades rather than drops. Set a recurring reminder for the annual re-assessment |
| **Meta business verification + Tech Provider + App Review** (D12) | Verification 2–5 business days; Tech Provider and App Review longer | Phase 12 | Hosted chat carries the negotiation with fewer restrictions. Build against Embedded Signup **v4** — v2 deprecated 15 Oct 2026 |
| **Google Calendar sensitive-scope verification** | Days | Phase 4 | *Sensitive*, not *restricted* — no CASA. Product functions fully with no calendar connected |
| **Legal review** (§8.3, §12.8, AGB, withdrawal rights) | Weeks | Phase 5 | Affects document wording, not architecture. Start once the quote template is drafted |
| **Anthropic DPA / zero-retention** | Days | Phase 0 | Standard commercial process |

### 13.3 What this trade actually costs
The original pitch was "never leave WhatsApp." Launching without a WhatsApp adapter means the owner taps once per inquiry to move a thread to the hosted chat (§4.2.1), or pastes it in (§4.4). That is real friction and it should be stated plainly to design partners rather than glossed.

What is gained: months off the timeline, no platform dependency on Meta, no per-conversation message fees, no template approval queue, no 24-hour re-engagement window, and a chat surface with a far richer UI than WhatsApp permits. The negotiation loop — which is the product — is unaffected, and arguably better.

---

## 14. Scope

### In
Hosted chat, email via alias, paste/forward/share-target intake, instant ack, AI extraction (text/image/document), in-conversation qualifying questions, detail form, calendar-aware deterministic pricing, guardrails + escalation, branded PDF + web quote, autonomous negotiation loop, explicit acceptance, owner dashboard with handoff and confirmation, two-step follow-up, onboarding via bulk upload + crawl + mandatory past quotes, DE/EN, owner + teammates, Stripe paywall with quota enforcement, GDPR baseline, **all six Art. 22 invariants with tests**, AI Act Art. 50 disclosure.

### Committed roadmap (required for the final product, sequenced after launch)
**Slack** (owner-side, phase 10) · **Gmail OAuth** (phase 11) · **WhatsApp adapter** (phase 12). See §4.5 and §13.2.

### Out (spec'd, not built)
Voice-note transcription · Instagram DM · Lexware/sevdesk sync · invoicing and payments to the agency · deposit collection · customer portal with login · e-signature · team workload routing · deep analytics · white-label tier · multi-currency · non-event verticals.

### Explicitly not planned
Unofficial WhatsApp automation (ToS violation, bans the agency's own number). Any AI-authored binding commitment. Any automated refusal of a customer. Any storage of the owner's private calendar event content. Any personal attribute as a pricing input.

---

## 15. Open questions

1. **Product name and domain.** Now blocks more than before: the chat lives at `chat.<domain>/a/{slug}` and the alias at `anfragen-{slug}@in.<domain>`, so it is customer-visible from day one.
2. **Legal review** — §8.3 wording, per-service withdrawal-rights analysis, AGB handling for agencies that have none. *Cannot be resolved by engineering.*
3. **Pricing of the product.** Brief hypothesises €19–49/month, tiered by volume, possible freemium at 3 quotes/month. Unvalidated — and now check it against real variable cost per inquiry (Claude tokens + storage + email), which the hosted-chat design makes materially cheaper than the WhatsApp design would have been.
4. **Market sizing for DACH small event agencies** — still unvalidated.
5. **Onboarding quality bar** — what happens when three uploaded quotes are inconsistent or extraction is poor? Needs an explicit manual-catalogue fallback path.
6. **Chat conversion rate** — the load-bearing unknown of rev. 2. What share of customers actually engage with a hosted chat link versus expecting WhatsApp? Measure this with the first three design partners; it determines how urgently the WhatsApp adapter is needed.
7. **Repeat customers** — reuse a prior EventBrief and quote as a starting point? Suggested, not yet spec'd.
8. **SLA promise wording** — the ack says "within X hours". Who sets X, what happens when it is missed?
9. **Stripe vs. Merchant of Record** — Paddle or Lemon Squeezy handle EU VAT/OSS but add a review step and fees. Stripe plus B2B reverse charge is likely simpler for a DACH-only launch. Decide before billing is built.

---

## 16. Build sequence

| Phase | Contents | Exit criterion |
|---|---|---|
| **0** | Repo, CI, Vercel, Supabase EU, schema, RLS, auth, tenancy tests. Start the §13.2 parallel track on day 1 | A request is tenant-scoped end to end; external clocks are running |
| **1** | Canonical envelope + hosted chat (`/a/{slug}`), streaming, uploads, AI disclosure, instant ack | A stranger reaches the link and is acknowledged in < 10s |
| **2** | Onboarding: bulk upload, crawl, extraction, confirmation UI, catalogue CRUD | An owner reaches a confirmed 5-item catalogue in under 15 minutes, unaided |
| **3** | Extraction → EventBrief with confidence and the `_contact` partition; in-chat qualifying; detail form | 20 real historical inquiries extract with required fields ≥ 0.8 |
| **4** | Pricing engine (pure function, §7.2 input contract) + calendar sync + guardrail evaluator | Golden-set totals reproduce exactly; every guardrail and all six Art. 22 invariants have a test that fails loudly on regression |
| **5** | Quote rendering (web + PDF), tokenised links, accept/decline/comment/request-human | A quote survives legal review and renders correctly on a phone |
| **6** | Negotiation loop, escalation, owner dashboard, handoff, confirmation | An inquiry runs end to end unattended and lands as a confirmable request |
| **7** | Email alias inbound + sending domain + follow-ups + SLA timers | An email inquiry runs the identical pipeline to a chat inquiry |
| **8** | Stripe paywall, plans, quota enforcement, customer portal | A stranger can sign up, pay, and be quota-limited without us touching anything |
| **9** | GDPR surfaces (export, delete, DPA, privacy links), Art. 22 assessment written up, DPIA screening documented, pilot with 3 agencies | Pilot agencies send real quotes to real customers |
| **10** | **Slack (owner-side)** — escalation alerts, one-tap approve/confirm/take-over, team channel, daily digest | Markus's team runs a full day without opening the dashboard |
| **11** | **Gmail OAuth** — interim testing mode, alias fallback live underneath, duplicate suppression on `Message-ID`, expiry notifications | A token expiring mid-inquiry loses nothing: the alias catches the reply and the owner is prompted to reconnect |
| **12** | **WhatsApp adapter** — Embedded Signup v4, six templates DE+EN, 24h-window logic, opt-in evidence | A WhatsApp inquiry runs the identical pipeline to a chat inquiry, with zero downstream code changes |

---

## 17. What "working" looks like

| Metric | Target |
|---|---|
| Acknowledgement latency | < 10s, p95 |
| Inquiry → first quote sent | < 5 min, p50, unattended |
| Inquiries auto-handled without owner touch before acceptance | ≥ 60% |
| Extraction accuracy on required fields | ≥ 95% after qualifying questions |
| Guardrail violations reaching a customer | **0** |
| Automated refusals of any customer | **0** (structurally impossible — §12.6) |
| Owner time per inquiry | < 3 min (from 30–60) |
| Quote view rate | ≥ 80% |
| Chat link → completed inquiry | ≥ 40% (new, unvalidated — open question #6) |
| Onboarding completion, unaided | ≥ 70% |

---

## Sources for the regulatory and platform claims in §12.7 and §13

- [EU AI Act transparency obligations take effect 2 August 2026 — Cooley](https://www.cooley.com/news/insight/2026/2026-08-03-eu-ai-act-transparency-obligations-take-effect-2-august-2026)
- [Transparency rules, Article 50 — EU Artificial Intelligence Act](https://artificialintelligenceact.eu/transparency-rules-article-50/)
- [Guidelines on transparency obligations — European Commission](https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems)
- [Restricted scope verification — Google for Developers](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Security assessment (CASA) — Google Cloud Console Help](https://support.google.com/cloud/answer/13465431)
- [Manage app audience / testing-mode limits — Google Cloud Console Help](https://support.google.com/cloud/answer/15549945)
- [Embedded Signup overview — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/)
- [Solution Partner / Tech Provider requirements — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview)

