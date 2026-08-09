# Offerprofi × SummerUP: competition playbook

Updated 2026-08-09.

## Evidence boundary

The participant page is authenticated. Its complete mobile screenshot was supplied on
2026-08-09 and all twelve cards below were transcribed from it. The screenshot records the
grant but not every provider's billing, DPA or expiry terms, so confirm those on each claim
page before connecting production data or payment details. The private screenshot stays
local and is deliberately excluded from Git.

Sources: [SummerUP 2026](https://summerup.berlin/) and the
[CODE 2025 recap](https://code.berlin/en/blog/summerup2025-hackathon/).

## The twelve private perks — exact use for Offerprofi

| Perk in the portal | Grant shown | Best Offerprofi use | Timing and guardrail |
|---|---|---|---|
| [Anthropic](https://www.anthropic.com/api) | **$100 API credit**, one link per participant, valid for 30 days | Turn on the already-built extraction, qualifying, contextual-prefix and service-mapping path. Spend the first calls on the golden evaluation set, then real pilot inquiries; watch `agent_runs` cost per tenant | Activate immediately before the first golden/live pilot if the 30-day clock starts on claim. Keep the tested human fallback and never use the model to calculate or expose a customer price |
| [PROM](https://www.prom-os.com/) | **1,000 credits**; one product free through the full Problem phase; data remains after the week | Make Offerprofi the single product and store interview evidence, ICP, riskiest assumptions, competitor claims and the €99.99 willingness-to-pay test | Set it up immediately. PROM holds discovery evidence; accepted product decisions still get written into this repository so the source of truth does not split |
| [Sliplane](https://sliplane.io/) | **€250 hosting credit**, handed out in person, for the deployment built this week | Host the pilot Next.js container and managed PostgreSQL in an EU location, with logs/metrics. This is the highest-leverage bridge from local demo to a URL a caterer can use | Collect it from the desk before leaving. Confirm whether the grant covers both runtime and managed PostgreSQL, backups and outbound traffic before committing |
| [n8n](https://n8n.io/) | **Full Cloud Pro licence for the week**, for every participant | Build three exportable operations workflows: qualified lead → personalized demo follow-up; pilot signup → onboarding checklist; nightly funnel metrics → founder digest | Use during the week and export the workflows before access ends. Keep it outside the customer request/pricing transaction, and send no customer PII through unapproved connectors |
| [Lovable](https://lovable.dev/) | **100 credits plus Pro Plan for one week** | Produce two disposable landing-page variants and a clickable prototype of the next owner correction loop for interview testing | Do not fork the production application or merge generated code blindly. Measure booked demos per variant, export the useful copy/design, then let the trial end |
| [Cognee](https://www.cognee.ai/) | **$100 memory credits**; open source remains available after cloud credit ends | Benchmark a memory/graph retrieval alternative against the existing PostgreSQL sparse layer on the same tenant-scoped 20-question golden set | Adopt only if it materially improves top-five retrieval without weakening tenant isolation or moving confirmed price facts into probabilistic search. Otherwise document the result and keep PostgreSQL |
| [Amie](https://amie.so/) | **One month free** | Time-block customer interviews, mentor office hours, live demos and the daily 09:00 commercial scorecard; use one scheduling link for pilots | This is founder operating leverage, not a product dependency. Keep caterer calendars out of it |
| [Sitefire](https://sitefire.ai/) | **Seven-day full trial**; the organizer can extend it | Baseline Offerprofi against Ktering/Better Cater for ten buying-intent prompts such as “Catering Angebotssoftware Deutschland,” then turn gaps into landing-page evidence and FAQ content | Activate only after the public landing page is live so the seven days produce a before/after. Ask the organizer for an extension on day one if indexing needs longer |
| [KugelAudio](https://docs.kugelaudio.com/) | **€50 credit plus 12 hours of expert time** per participant | Use the expert time to review a German voice-channel design and produce a strong 60–90 second German demo narration. Its TTS can later read summaries accessibly | It is text-to-speech, not the speech-to-text needed for customer voice notes. Do not replace the planned transcription path or clone a person's voice without explicit consent |
| [Tavily](https://docs.tavily.com/) | **8,000 search credits** | Enrich the 100-caterer sales list, monitor competitor changes and prototype an owner-authorized website/menu importer whose extracted candidates always require confirmation | Use public business pages only; no customer messages or personal data. Cache results and cap crawl breadth so a malformed site cannot burn the grant |
| [Lance](https://www.lance.app/) | **1,000 credits on signup** | Reserve for App Store/TestFlight automation if pilot caterers prove they need an iOS owner companion; use it for signing, screenshots, metadata and submissions | The portal does not show the destination URL, so verify the claim lands on this App Store product before connecting Apple credentials. Do not build a mobile app merely to consume the credit |
| [Fideus](https://holding.fideus.de/) | **€150 off** startup/holding tax administration; portal says offers start at €400 | Use for a scoped German founder-tax/entity session and, only if already appropriate, digital annual filing/holding administration | The public offer currently shows different starting pricing, so confirm the discounted scope in writing. Never form a holding just to use a coupon |

### Claim order

1. **Today at the venue:** collect Sliplane, book KugelAudio's expert hours, ask Sitefire for
   the extension, and clarify the Lance URL and Fideus scope at the organizer desk.
2. **Today online:** activate PROM, n8n, Lovable, Cognee, Tavily and Amie; record activation,
   expiry, auto-renewal/payment requirement, DPA link and export path in one checklist.
3. **When deployment is ready:** activate the 30-day Anthropic grant and put the Sliplane
   pilot online. Run the golden set before the first live caterer inquiry.
4. **After the public URL exists:** start Sitefire's seven-day measurement window. Keep
   Lance dormant until pilot evidence justifies an iOS app.

### The combined flywheel

`Tavily prospect evidence → n8n personalized demo follow-up → Amie booking → Offerprofi live
conversion → PROM interview evidence → Lovable message experiment → Sitefire visibility
measurement.` Anthropic powers only the product's bounded intelligence; Sliplane runs it;
Cognee is a measured retrieval challenger; KugelAudio creates the voice proof. Every tool has
one job and an exit path.

## The wedge to sell

Do not pitch another all-in-one catering ERP. Sell one measurable outcome:

> **Every messy web or WhatsApp inquiry becomes an owner-ready catering brief in minutes,
> in the caterer's own language, without an AI inventing or exposing a price.**

The closest German positioning found is [Ktering](https://www.ktering.de/): an eight-step
request form, pipeline, rule-based item and quantity suggestions, offer editor, German
hosting and ZUGFeRD from €149/month. International suites such as
[Better Cater](https://www.bettercater.com/) compete on breadth: CRM, proposals, calendars,
recipes, production reports, payments and packing lists from $99/month.

Offerprofi should not race either one feature-for-feature during SummerUP. Its credible
advantage is lower-friction conversational qualification plus a safety architecture the
owner can trust: customer-side requests contain no money, pricing is deterministic and
owner-side, historic documents teach language without storing the originals, and every
customer-facing offer remains human-approved.

## Eight-day scoreboard

| Deadline | Proof, not activity |
|---|---|
| Day 1 | 20 caterer conversations; identify the three exact inquiry formats that waste the most time |
| Day 2 | 100-account Berlin/DACH prospect list; two landing-page messages tested; ten live demos booked |
| Day 3 | Three paid pilots at €99.99/month or paid deposits; five additional written LOIs |
| Day 5 | At least 25 real inquiries processed; median time from raw message to owner-ready brief under three minutes |
| Day 7 | 80%+ of pilot briefs accepted without re-entering core facts; zero customer price leaks; zero AI refusals |
| Pitch Day | Three paying logos, ten-account pipeline (~€12k ARR), a 90-second live proof and one quantified customer story |

The bar is intentionally commercial. SummerUP's 2025 winner reported €127.8k ARR pipeline
and 8+ LOIs in seven days; the runner-up signed three €500 paid-beta customers. A polished
demo without commitments will not be competitive with that evidence.

## Use each public benefit deliberately

- **Founder and investor office hours:** book sessions with one decision each—DACH
  distribution, €99.99 pricing, security/legal buyer objections, and whether the wedge is
  qualification or full offer creation. Bring funnel numbers and a screen recording, not a
  general product tour.
- **Paid-ads validation (Lukas Kneip):** test “never lose a catering request overnight”
  against “turn WhatsApp chaos into an offer-ready brief.” Optimize for booked pilot calls,
  not email sign-ups.
- **First-ten-customer cold email (Max Schulz) and B2B closing (Marcus Daftari):** build a
  100-caterer sequence around one of their own public menus and show a sample structured
  brief. The call-to-action is a 15-minute live conversion of a real inquiry.
- **AI-enabled GTM (Stephan/Arvana):** turn each successful pilot inquiry into a reusable,
  permissioned before/after proof asset. Never put unverified AI claims in the pitch.
- **Viral launch (Folkert/pick'em):** make the shareable artifact the result—“raw message →
  decision-ready request in 42 seconds”—not a generic launch announcement.
- **Pitch coaching (Oskar Lingk/Project A):** frame the moat as accumulated, tenant-isolated
  catering context plus deterministic owner-side economics and a no-price-leak boundary.
  Lead with paid proof; architecture supports the claim rather than replacing it.
- **Premium sponsor resources:** spend hosting/automation credits only on release-critical
  costs: EU database/runtime, monitoring, transactional email and the sales experiment.
  Do not add Neo4j or another subsystem merely because a credit exists; the current small,
  homogeneous corpus is intentionally served by PostgreSQL sparse retrieval.
- **Workspaces and Builders Breakfast:** run a daily 09:00 scorecard—conversations, demos,
  deposits, processed inquiries, acceptance rate and blockers—then ask for introductions to
  caterers, hospitality operators and DACH vertical-SaaS founders.
- **The Delta stage and VC exposure:** treat funding as an outcome of customer proof. The
  pitch should end with the next repeatable unit: one caterer onboarded in under 15 minutes,
  three historic offers ingested, and their public inquiry link live the same day.

## Product moves that compound after the event

1. Add an owner correction loop so every edited fact and accepted service mapping becomes
   confirmed tenant knowledge. Measure suggestion acceptance rather than claiming “learning.”
2. Add a migration concierge: import three offers and five catalogue items for the caterer
   during the sales call. Time-to-value is a competitive feature.
3. Instrument the funnel from chat opened → first message → request sent → owner opened →
   offer approved. Compete on conversion and response time, not feature count.
4. Build outbound email/password recovery and production deletion/export before broad paid
   acquisition. These are trust and operability requirements, not pitch-day decoration.
5. After the wedge converts, add the operations layer customers actually request—calendar,
   contracts/payments, production lists—rather than copying a mature suite's entire surface.

## Perk safety rule

Claiming all twelve is sensible; consuming all twelve is not a success metric. A perk earns a
place in the stack only when it moves paid pilots, deployment reliability, onboarding time or
measured retrieval quality. Keep credentials out of PROM/Lovable prototypes, export every
short-trial artifact, and do not send customer PII to Cognee, n8n, Tavily or voice services
until the provider contract and privacy disclosure support it. Unused credits are cheaper
than architecture debt.
