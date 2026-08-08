# ORIGINAL_BRIEF.md — Source Record

Preserved verbatim for fidelity. Nothing here is edited or interpreted — interpretation lives in
[CLAUDE.md](../CLAUDE.md) and [PRODUCT_SPEC.md](../PRODUCT_SPEC.md).

- **Part A** — the original German concept brief as supplied, 08.08.2026
- **Part B** — English translation
- **Part C** — requirements interview, questions and the owner's answers verbatim
- **Part D** — follow-up direction given by the owner

---

# Part A — Original German brief (verbatim)

**Arbeitstitel:** *(z. B. "OfferPing", "EventSnap", "AngebotBot" – Name noch offen)*

**Stand:** 08.08.2026
**Status:** Ideation / Konzeptphase

## 🎯 Elevator Pitch

Kleine Eventagenturen verkaufen heute schon fast komplett über WhatsApp – aber sobald ein Angebot geschrieben werden muss, wechseln sie in Word, Excel oder Canva und verlieren dabei Zeit, Tempo und oft den Kunden. Wir bauen das Tool, mit dem Eventagenturen direkt aus dem WhatsApp-Chat heraus in wenigen Minuten ein professionelles, individualisiertes Angebot erstellen und verschicken können – ohne Systembruch, ohne Copy-Paste-Chaos.

## 🧩 Das Problem

Kleine Eventagenturen (1–5 Personen: Hochzeitsplaner:innen, Deko- und Locationservices, DJ/Fotobox-Anbieter, Caterer, Agenturen für Firmenevents) führen ihre gesamte Kundenkommunikation praktisch von der ersten Anfrage bis zur Buchung über WhatsApp. Genau dort bricht der Prozess aber ab:

**Systembruch:** Anfrage kommt per WhatsApp, das Angebot entsteht in Word/Excel/Canva – manuelles Übertragen von Infos, Copy-Paste, Formatieren.

**Zeitverlust:** Ein individuelles Angebot dauert oft 30–60 Minuten, bei mehreren Anfragen pro Tag ein spürbarer Admin-Block ohne Umsatzwirkung.

**Tempoverlust = verlorene Deals:** Kund:innen fragen bei 3–5 Agenturen gleichzeitig an. Wer zuerst ein überzeugendes Angebot schickt, gewinnt oft unabhängig vom Preis. Kleine Agenturen ohne Backoffice verlieren hier strukturell gegen größere Wettbewerber.

**Unprofessionelle Wirkung:** Handgestrickte Word-PDFs oder reine Preislisten im Chat wirken wenig hochwertig – gerade bei Hochzeiten/Firmenevents ein Vertrauensproblem.

**Kein Überblick:** Keine zentrale Übersicht, welches Angebot raus ist, wer noch nicht geantwortet hat, was angenommen wurde – Nachfassen passiert (wenn überhaupt) aus dem Bauchgefühl.

**Klassische CRM/Angebotstools passen nicht:** Tools wie PandaDoc, HoneyBook oder klassische CRMs sind für den US-Markt bzw. größere Teams gebaut, erfordern einen zusätzlichen Login/Workflow außerhalb von WhatsApp und sind für Solo-/Kleinstagenturen zu schwer, zu teuer oder zu komplex.

## 💡 Value Proposition

**"Vom WhatsApp-Chat zum verschickten Angebot in unter 5 Minuten – professionell, gebrandet, ohne Tool-Wechsel."**

**Geschwindigkeit:** Angebote entstehen dort, wo die Konversation ohnehin stattfindet – kein Wechsel zwischen Apps.

**Professionalität:** Aus Stichworten/Chat-Infos wird automatisch ein sauber formatiertes, gebrandetes Angebot (PDF/Link) mit Logo, Leistungen, Preisen, AGB.

**Geschwindigkeit schlägt Konkurrenz:** Wer als Erstes ein gutes Angebot schickt, hat die höchste Abschlusswahrscheinlichkeit – das Tool macht kleine Agenturen so schnell wie große.

**Überblick:** Zentrales Dashboard über offene, angenommene und abgelehnte Angebote, automatische Erinnerungen zum Nachfassen.

**Kein Umlernen:** Keine neue Kommunikations-App nötig – die Agentur bleibt in WhatsApp, das Tool arbeitet im Hintergrund/als Erweiterung.

## 🛠️ Wie es funktioniert (Grobkonzept)

1. **Eingang, kanalunabhängig:** Anfrage kommt per WhatsApp oder E-Mail – beide Kanäle laufen in denselben Intake-Layer, es gibt keine zwei getrennten Prozesse.
2. **Sofort-Bestätigung:** automatische Eingangsbestätigung auf beiden Kanälen in Sekunden ("Danke für deine Anfrage, du bekommst innerhalb von X Stunden ein Angebot") – nimmt sofort den Druck, unabhängig davon, wann die Agentur tatsächlich Zeit hat.
3. **KI-Extraktion:** Eckdaten (Event-Typ, Datum, Gästezahl, Budget, Location) werden automatisch aus Freitext, Sprachnachricht oder E-Mail erkannt – nichts, was schon genannt wurde, wird nochmal abgefragt.
4. **Fehlende Angaben, zweistufig:**
    - *Stufe 1:* kritische Pflichtfragen direkt in WhatsApp per Quick-Reply-Buttons, während der Kunde noch "warm" ist
    - *Stufe 2:* optionaler Link zu einem kurzen Web-Formular für Detailfragen (Deko-Stil, Catering, Sonderwünsche) – erst nach Grundqualifikation, positioniert als Mehrwert, nicht als Hürde
5. **Angebots-Entwurf:** System matched die strukturierten Daten gegen die im Tool hinterlegte Preisliste/Leistungspakete und erstellt automatisch ein gebrandetes PDF-Angebot (eigene Template-Engine, MVP-Version ohne externe Buchhaltungssoftware)
6. **Review & Versand:** Agentur prüft, passt bei Bedarf an, verschickt mit einem Klick über den Ursprungskanal (WhatsApp oder E-Mail)
7. **Tracking & Nachfassen:** Status (offen/angenommen/abgelehnt) im Dashboard, SLA-Timer markiert zu lange offene Anfragen, automatische Erinnerungen zum Nachfassen
8. **Onboarding-Booster:** beim Setup kann die Agentur 3–5 alte Angebote hochladen – das System erkennt daraus automatisch Template/Branding sowie typische Leistungspakete und Preise (nach Bestätigung durch die Agentur), sodass Preisliste und Design nicht manuell aufgebaut werden müssen
9. **Later/Premium:** direkte Anbindung an Lexware/sevdesk (API ab höheren Tarifen verfügbar) – Angebot wird dort automatisch angelegt und wird bei Annahme direkt zur Rechnung; für den MVP bewusst nicht Voraussetzung

## 👥 Zielgruppe

**Primär:** Inhaber:innen kleiner, eigentümergeführter Eventagenturen und Einzelunternehmer:innen im DACH-Raum, typischerweise 1–5 Personen, ohne eigenes Backoffice/Sales-Team.

Konkrete Segmente:

- Hochzeitsplaner:innen / Wedding Planner
- Deko- & Ausstattungsverleih für Events
- DJ-, Foto-/Videobox- und Entertainment-Anbieter
- Catering- und Location-Scouting-Dienste
- Kleine Agenturen für Firmen- und Privatevents (Geburtstage, Jubiläen, Teamevents)

**Gemeinsame Merkmale:**

- Kundenakquise läuft stark über Instagram/Google → Erstkontakt fast immer via WhatsApp
- Hohes Anfragevolumen, aber begrenzte Zeit für Administration
- Preisbewusst bei Software – klassische CRM-Lizenzen (50–150 €/Monat) werden als überdimensioniert empfunden
- Technisch offen (nutzen WhatsApp Business, Instagram, Canva), aber ablehnend gegenüber komplexer Software

**Sekundär (später):** Mittelgroße Eventagenturen mit mehreren Mitarbeitenden, die Angebote im Team koordinieren möchten.

## 🙋‍♀️ Personas

### Persona 1: Lisa, 32 – Solo-Hochzeitsplanerin

- Führt ihr Business seit 3 Jahren allein, ca. 15–20 Hochzeiten/Jahr
- Akquise über Instagram, komplette Beratung läuft über WhatsApp
- Erstellt Angebote aktuell in Canva-Vorlage + Excel-Preiskalkulation, ca. 45 Min/Angebot
- Schreibt oft abends/am Wochenende, wenn die "eigentliche" Arbeit ruht
- Frustration: verliert Bräute an schnellere Agenturen, obwohl ihr Angebot inhaltlich stärker wäre
- Wunsch: aus dem Chat heraus in Minuten ein Angebot verschicken, das genauso hochwertig wirkt wie ihr Instagram-Profil

### Persona 2: Markus, 41 – Inhaber einer kleinen Agentur für Firmenevents

- 2 feste Mitarbeitende, betreut Firmenkunden (Sommerfeste, Teamevents, Kick-offs)
- Corporate Kunden holen meist 3 Vergleichsangebote ein – Reaktionszeit ist häufig ausschlaggebend
- Nutzt aktuell Word-Vorlagen, die manuell an jede Anfrage angepasst werden
- Frustration: verliert Ausschreibungen nicht am Preis, sondern an der Reaktionsgeschwindigkeit der Konkurrenz
- Wunsch: Standardbausteine (Leistungspakete, Staffelpreise) wiederverwenden, aber pro Kunde individuell und schnell anpassen

### Persona 3 (sekundär): Jana, 29 – Deko- & Fotobox-Verleih

- Sehr hohes Anfragevolumen (oft 10+/Woche), viele Anfragen sind unverbindlich/Preisvergleich
- Braucht vor allem Tempo bei standardisierten Angeboten, weniger Individualisierung
- Wunsch: Vorlagen-basiert, fast automatisiert, minimaler Aufwand pro Anfrage

## 🏆 Wettbewerb & Differenzierung

| **Alternative** | **Warum unzureichend** |
| --- | --- |
| Word/Excel/Canva-Vorlagen | Manuell, langsam, kein System, kein Tracking |
| PandaDoc, Better Proposals, HoneyBook | Für größere Teams/US-Markt gebaut, eigenständiges Tool außerhalb WhatsApp, zu teuer/komplex für Solo-Agenturen |
| Generische CRMs (HubSpot etc.) | Zu mächtig, zu hoher Einrichtungsaufwand für 1-Personen-Betrieb |
| WhatsApp Business (nativ) | Kein Angebots-/Dokumenten-Feature, keine Vorlagen, kein Tracking |

**Differenzierung:** Einziges Tool, das nativ im WhatsApp-Workflow kleiner Eventagenturen ansetzt, branchenspezifische Vorlagen mitbringt und explizit auf Solo-/Kleinstteams zugeschnitten ist (Setup in Minuten, kein Sales-Onboarding nötig).

## 💰 Geschäftsmodell (erste Hypothese)

- **SaaS-Abo**, monatlich kündbar, pro Agentur/Account
- Staffelung nach Angebots-Volumen/Monat (z. B. Starter: bis 15 Angebote, Pro: unbegrenzt + Team-Funktion)
- Möglicher Freemium-Einstieg (z. B. 3 Angebote/Monat kostenlos) zur Reduktion der Einstiegshürde
- Später denkbar: Provisionsmodell bei erfolgreicher Buchung, White-Label für Verbände/Netzwerke von Eventagenturen

*(Preispunkte noch zu validieren – Richtwert grob zwischen 19–49 €/Monat für Solo-Tarif)*

## ⚠️ Offene Fragen & Risiken

**Technische Machbarkeit:** WhatsApp Business API vs. Meta-Richtlinien – wie tief lässt sich das Tool wirklich in den Chat integrieren (nativ vs. paralleles Dashboard mit Chat-Import)?

**Abhängigkeit von Meta/WhatsApp:** API-Änderungen oder Restriktionen sind ein strukturelles Plattformrisiko

**Willingness to pay:** Ist die Zielgruppe bereit, für ein Nischentool zu zahlen, oder wird "gut genug" mit Canva/Word akzeptiert?

**Marktgröße:** Anzahl kleiner Eventagenturen in DACH noch nicht validiert – vor Weiterentwicklung recherchieren

**Onboarding-Aufwand:** Wie einfach lässt sich das Tool ohne technisches Vorwissen einrichten (Zielgruppe ist nicht IT-affin)?

## 🚀 Nächste Schritte (Vorschlag)

- 5–10 Interviews mit Eventagenturen zur Validierung von Problem & Zahlungsbereitschaft
- Technische Machbarkeitsprüfung der WhatsApp Business API (Angebots-/Dokumentenversand, Automatisierungsgrenzen)
- Klick-Prototyp / Mock-up des Angebots-Flows
- Landingpage mit Value Proposition zur Nachfragevalidierung (Waitlist)
- MVP-Scope definieren (manuelles Grundsetup vs. volle Automatisierung)

---

# Part B — English translation

**Working title:** *(e.g. "OfferPing", "EventSnap", "AngebotBot" — name still open)*
**As of:** 08.08.2026 · **Status:** Ideation / concept phase

## Elevator pitch
Small event agencies already sell almost entirely over WhatsApp — but the moment a quote has to be written, they switch to Word, Excel or Canva and lose time, momentum, and often the customer. We are building the tool that lets event agencies create and send a professional, individualised quote directly out of the WhatsApp chat in a few minutes — no system break, no copy-paste chaos.

## The problem
Small event agencies (1–5 people: wedding planners, décor and venue services, DJ/photo-box providers, caterers, corporate-event agencies) run their entire customer communication from first inquiry through to booking over WhatsApp. That is exactly where the process breaks down:

- **System break:** the inquiry arrives on WhatsApp, the quote is written in Word/Excel/Canva — manual transfer of information, copy-paste, formatting.
- **Time loss:** an individual quote often takes 30–60 minutes; with several inquiries a day this is a noticeable block of admin with no revenue effect.
- **Loss of speed = lost deals:** customers inquire at 3–5 agencies simultaneously. Whoever sends a convincing quote first often wins regardless of price. Small agencies without a back office lose here structurally against larger competitors.
- **Unprofessional impression:** homemade Word PDFs or bare price lists in the chat feel low-value — a trust problem especially for weddings and corporate events.
- **No overview:** no central view of which quote went out, who hasn't replied, what was accepted — follow-up happens (if at all) on gut feeling.
- **Classic CRM/quoting tools don't fit:** PandaDoc, HoneyBook and traditional CRMs are built for the US market and larger teams, require an additional login and workflow outside WhatsApp, and are too heavy, too expensive or too complex for solo and micro agencies.

## Value proposition
**"From WhatsApp chat to sent quote in under 5 minutes — professional, branded, no tool switching."**

- **Speed:** quotes are created where the conversation already happens — no switching between apps.
- **Professionalism:** keywords and chat information automatically become a cleanly formatted, branded quote (PDF/link) with logo, services, prices, terms.
- **Speed beats the competition:** whoever sends a good quote first has the highest closing probability — the tool makes small agencies as fast as large ones.
- **Overview:** central dashboard of open, accepted and rejected quotes, with automatic follow-up reminders.
- **No relearning:** no new communication app needed — the agency stays in WhatsApp, the tool works in the background as an extension.

## How it works (outline concept)
1. **Channel-independent intake:** inquiry arrives by WhatsApp or email — both channels run into the same intake layer, there are not two separate processes.
2. **Instant acknowledgement:** automatic receipt confirmation on both channels within seconds ("Thanks for your inquiry, you'll get a quote within X hours") — takes the pressure off immediately, regardless of when the agency actually has time.
3. **AI extraction:** key data (event type, date, guest count, budget, location) recognised automatically from free text, voice message or email — nothing already mentioned is asked again.
4. **Missing information, two stages:**
   - *Stage 1:* critical mandatory questions directly in WhatsApp via quick-reply buttons, while the customer is still warm
   - *Stage 2:* optional link to a short web form for detail questions (décor style, catering, special requests) — only after basic qualification, positioned as added value, not as a hurdle
5. **Quote draft:** the system matches the structured data against the price list / service packages stored in the tool and automatically creates a branded PDF quote (own template engine, MVP version without external accounting software)
6. **Review & send:** the agency checks, adjusts if needed, and sends with one click via the original channel (WhatsApp or email)
7. **Tracking & follow-up:** status (open/accepted/rejected) in the dashboard, SLA timer flags inquiries left open too long, automatic follow-up reminders
8. **Onboarding booster:** during setup the agency can upload 3–5 old quotes — the system automatically recognises template/branding as well as typical service packages and prices (after confirmation by the agency), so the price list and design don't have to be built manually
9. **Later/premium:** direct connection to Lexware/sevdesk (API available from higher tiers) — the quote is created there automatically and becomes an invoice on acceptance; deliberately not a prerequisite for the MVP

## Target group
**Primary:** owners of small, owner-run event agencies and sole traders in the DACH region, typically 1–5 people, without their own back office or sales team.

Segments: wedding planners · décor and equipment rental for events · DJ, photo/video-box and entertainment providers · catering and venue-scouting services · small agencies for corporate and private events (birthdays, anniversaries, team events).

**Shared characteristics:** customer acquisition runs heavily via Instagram/Google → first contact almost always via WhatsApp · high inquiry volume but limited time for administration · price-conscious about software, classic CRM licences (€50–150/month) feel oversized · technically open (they use WhatsApp Business, Instagram, Canva) but resistant to complex software.

**Secondary (later):** mid-sized event agencies with several employees who want to coordinate quotes as a team.

*(Personas, competition, business model and open questions are translated in [CLAUDE.md](../CLAUDE.md) §11, §12, §9.)*

## Proposed next steps (from the brief)
- 5–10 interviews with event agencies to validate the problem and willingness to pay
- Technical feasibility check of the WhatsApp Business API (quote/document sending, automation limits)
- Clickable prototype / mock-up of the quote flow
- Landing page with the value proposition to validate demand (waitlist)
- Define MVP scope (manual basic setup vs. full automation)

---

# Part C — Requirements interview (verbatim answers)

Conducted 2026-08-08. Questions were multiple-choice with a free-text option; the owner's selections and free-text answers are reproduced exactly.

### Round 1 — product shape

| Question | Answer |
|---|---|
| Which channel is the MVP built around? | **Both from day one** |
| What is the actual output — what does "done" look like for one inquiry? | **Quote/offer (Angebot)** |
| What should be produced at the end of the interview? | **Spec .md only** |
| How much should the system act on its own before a human touches it? | **Full auto for standard cases** |

### Round 2 — ingestion

**Q: How does the agency's own data (branding, services, prices) get into the system at onboarding?**

> "for most For most businesses, local SMBs, whatever it may be, they have to realistically have some type of PDF, some type of data. Usually it's not something that's overly complicated, but it should be like around like, I don't know, a whole folder of like context for the agent that they upload, and then it scans all of their content, their brand identity, maybe ingests like a link for a landing page that they have a website that has price information, some type of PDF, ingest, like that's the sort of thing that most local non-technical SMB business owners have
>
> So it also previous For the onboarding also previous quotes that were created by the catering service are mandatory to be shared, so a type of brand information. Yeah, gener brand information can also be quotes of any kind so that the way the individual way of the additional services are understood by the agent and hence subsequent code generation is as accurate as possible"

**Q: Which customer-side input types must the intake layer ingest?**

> "attached documents and images and screenshots and also pasted text files and chats"

**Q: How is the price on the quote actually calculated?**

> "So basically how it's gonna run is gonna be deterministic rule over the catalog that the customer uploads into the UI but the idea here is gonna keep looping keep reiterating until the customer has a satisfactory call output and like quote output, not a call output and the basic idea here is that the output should be basically tailored towards the needs of the customer and then after the customer is satisfied it then is formatted into a formal request and sent and displayed on the dashboard of the owner and then he can actually connect with that client and fulfill the order and you know further discuss any unclarities but yeah"

*(This answer is the origin of D7 — the agent negotiates with the end customer and the owner enters after agreement, inverting step 6 of the original brief.)*

**Q: Who logs into the product, and does the end customer get their own surface?**
> **Owner + optional teammates, customer gets links**

### Round 3 — guardrails and legal

| Question | Answer |
|---|---|
| What may the agent commit to without the owner seeing it first? | **Catalogue prices only, hard floor** |
| Legally, what is the document the agent sends in DACH? | **Non-binding, owner confirms** |
| Voice notes — in or out? | **Out of MVP, spec'd as v2** |
| What event ends the customer loop and pushes to the dashboard? | **Explicit accept on the quote link** |

### Round 4 — plumbing

| Question | Answer |
|---|---|
| How do we connect to WhatsApp? | **Meta Cloud API direct** |
| How does email get in and out? | **Full Gmail OAuth** |
| Should the quote engine know whether the owner is free? | **Yes — calendar-aware quoting** |
| What stack should the plan target? | **Next.js + Supabase, EU region** |

### Round 5 — market and compliance

| Question | Answer |
|---|---|
| Event agencies only, or SMBs generally? | **Event agencies only** |
| How do we handle AI processing of personal data? | **Claude API + DPA, no training** |
| How aggressively do we chase a silent customer? | **Two nudges, then owner task** |
| What language and tone does the agent write in? | **DE + EN, mirror the customer** |

---

# Part D — Follow-up direction from the owner

### D.1 On making the critical path technical (verbatim)

> "Explore how we can make the critical path technical and non-external so that we don't have to go around all these API and business verification processes where we can just push the prod, create a GitHub repo, and file under a certain product and paywall that product"

### D.2 On GDPR Article 22 (verbatim)

> "Also, considering 8.3 I don't really care about the pricing answer that changes the legal shape of the product. Like, I just want it to be something that even if it's an unbind binding framing for D9, that it's not just risk reduction, I want it to completely be out of GDPR Article 22, where automated decision territory is completely avoided. I don't want any conflicts with the law in that sense"

**→ Resolved as D22 and the six invariants in [CLAUDE.md](../CLAUDE.md) §2.**

### D.3 On channel roadmap, Slack and AI disclosure (verbatim)

> "ok so I like the our own chat Ui functionality to bypass the whole whatsapp flow for now but we have to keep in the scope of the ultimate final product that these verfifications still have to come through in those terms so that the final product uses the gmail and whatsapp ingestions maybe even a slack integration for now till whatsapp is approved it is ok for now for every agency to reverify that after seven days the whole event finishes up in less than a week anyway on article 50 it is ok to include a disclaimer for users to know that they are talking to an AI completely fine by me."

**→ Resolved as D1 (revised), D12, D13, D27, D28 and the channel roadmap in [CLAUDE.md](../CLAUDE.md) §4.**

**Noted correction, recorded for the record:** the owner's reasoning that "the whole event finishes up in less than a week anyway" does not match how Google's 7-day refresh-token expiry works. The expiry is scoped to the *agency's mailbox connection*, not to an individual event or inquiry. An agency is a permanent tenant sending quotes continuously for years, so the connection dies every 7 days regardless of event lifecycle, requiring the owner to click through Google's "unverified app" warning screen weekly until CASA clears. The owner accepted this interim path after the correction was raised. The mitigation carried into the spec is that the forwarding alias stays live underneath Gmail OAuth as a permanent fallback, so an expired token degrades the channel rather than silently dropping inquiries — which would otherwise be the exact failure mode the product exists to prevent.

---

# Part E — External findings (verified 2026-08-08)

Research conducted during the specification phase. These findings drove the rev. 2 architecture.

| Finding | Detail | Impact |
|---|---|---|
| **Gmail testing mode is unusable in production** | Google invalidates refresh tokens after 7 days for unverified apps; hard cap of 100 test users; "unverified app" warning screen shown before consent | Killed the "pilot on OAuth while CASA runs" plan. Forwarding alias became the launch design |
| **CASA Tier 2 got much cheaper** | Self-serve path via approved labs, $540–1,000 (was $15,000–75,000 under the old manual assessment). Timeline still 4–12+ weeks including Google's own review. **Annual re-verification required** | Gmail OAuth is affordable but remains a parallel track, never a critical path |
| **Meta verification is faster than assumed** | Business verification 2–5 business days, up to 14 if documents are incomplete | The real gate is Tech Provider status + App Review for Embedded Signup, not verification itself |
| **Embedded Signup v2 deprecation** | v2 deprecated **15 October 2026** | Build against v4 |
| **AI Act Art. 50 is live** | Transparency obligations applied from **2 August 2026**. Explicitly excluded from the Digital Omnibus deferral that pushed Annex III high-risk compliance to **2 December 2027**. Enforceable by national market surveillance authorities. Fines up to **€15M or 3% of worldwide annual turnover** | Made AI disclosure mandatory, not optional. Owner confirmed (D25) |
| **Art. 50(2) limited exception** | Marking obligations for synthetic audio/image/video/text delayed to **2 December 2026** for systems already on the market before 2 August 2026 (provisional Council/Parliament agreement, 7 May 2026) | A product launching after that date should implement marking from the start |
| **Google Calendar scopes** | `calendar.readonly` is a *sensitive* scope, not *restricted* — **no CASA required**, review measured in days | Calendar integration is not on the critical path |

### Sources

- [EU AI Act transparency obligations take effect 2 August 2026 — Cooley](https://www.cooley.com/news/insight/2026/2026-08-03-eu-ai-act-transparency-obligations-take-effect-2-august-2026)
- [Transparency rules, Article 50 — EU Artificial Intelligence Act](https://artificialintelligenceact.eu/transparency-rules-article-50/)
- [Guidelines on transparency obligations — European Commission](https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems)
- [Restricted scope verification — Google for Developers](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Security assessment (CASA) — Google Cloud Console Help](https://support.google.com/cloud/answer/13465431)
- [Manage app audience / testing-mode limits — Google Cloud Console Help](https://support.google.com/cloud/answer/15549945)
- [Embedded Signup overview — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/)
- [Solution Partner / Tech Provider requirements — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview)
