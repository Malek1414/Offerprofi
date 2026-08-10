# Progress and session handoff

**Updated:** 2026-08-10

> ## ANTHROPIC LIVE QA, NLP REPAIR, AND READINESS SCORE — 2026-08-10
>
> **This section supersedes the historical statements below that say the Anthropic key is
> missing.** A local key is now configured in the ignored `.env.local`; its value is not in
> the repository. The real Claude path has been exercised from customer chat through send,
> customer request document and owner inbox. Because the credential was pasted into a chat,
> rotate it after this test session and replace the local/hosted secret before any pilot.
>
> ### Headline assessment
>
> **Current sell-readiness: 6.7/10.** On the requested scale, this is suitable for a small,
> supervised design-partner or paid pilot, but it is not yet a self-serve product that can be
> sold as flawless. **Model intelligence: 7.9/10; response sophistication: 7.6/10.** The
> model now extracts and asks well, while application code owns completion, safety, layout
> and the final recap. That division is materially more dependable than asking the model to
> write the whole experience. Latency, evaluation breadth, transcript completeness and one
> remaining class of semantic duplication keep the overall product below an 8.
>
> | Area | Score | Evidence and interpretation |
> |---|---:|---|
> | Fact extraction | **8.5/10** | Correctly recovered occasion, ISO date, headcount, full venue, service style, fulfilment, duration, staffing, diet, budget and contact across the live German scenarios. Unknown or malformed typed values are now dropped rather than coerced. |
> | Question relevance | **7.8/10** | Questions were operationally useful and used prior answers. Code now limits each entry to one `?`, 280 characters and two entries per turn. The live result asked about delivery/service, dietary needs, exact venue and duration rather than repeating the required facts. |
> | Language and character handling | **8.2/10** | Correct formal German and natural acknowledgements after repair. A shared boundary normalizer fixes literal `\\uXXXX` sequences and identifiable UTF-8-as-Latin-1 mojibake while leaving valid multilingual text unchanged. Broad native-speaker and multilingual sampling is still owed. |
> | Grounding and hallucination control | **8.8/10** | Ready-state summaries are now deterministic rows from the typed request, not a second prose-generation call. This removed an invented reception detail, contact repetition, unsupported caveats and accidental verbosity seen in the first live test. Customer summaries still cannot expose budget. |
> | Multi-turn continuity | **7.6/10** | Structured state correctly accumulated three customer turns and the owner received the final facts. Later turns now use a short acknowledgement instead of replaying the full first-contact promise. Assistant outbound messages are still not persisted for the owner's transcript, which is a real context gap. |
> | Reliability and fail-safe behavior | **7.0/10** | The initial provider-schema failure handed the conversation to a person without exposing an exception. Provider success, send, customer document and owner inbox were then verified. Only two live scenarios have been sampled, so variance is not yet measured. |
> | Speed and cost efficiency | **5.3/10** | The repaired three-turn journey completed in approximately **17.1 s, 13.1 s and 10.4 s** per turn after the instant acknowledgement. Five model calls consumed 9,628 input and 2,100 output tokens, logged 35.0 s cumulative provider latency, and cost **10.064 US cents**. Opus for sequential extraction plus question-writing is too slow and expensive to call top-tier without a routing eval. |
>
> ### First live test — what failed before the repairs
>
> 1. The API key, credits and `claude-opus-5` were valid: a minimal SDK structured-output
>    call succeeded. The application extraction call did not. `agent_runs` recorded
>    `failure:invalid_request` after 1,125 ms.
> 2. Exact reproduction against the application schema found two provider compilation
>    boundaries. The first shape contained 19 union parameters, above the provider limit of
>    16. Removing nullable contact fields exposed a second error: the compiled grammar was
>    still too large. Anthropic documents both restrictions under
>    [structured-output limitations](https://platform.claude.com/docs/en/build-with-claude/structured-outputs#considerations-and-limitations).
> 3. After the provider schema was made valid, the model extracted the first wedding request
>    accurately, including 18 September 2027, 120 people, Berlin, vegetarian buffet,
>    drinks, EUR 9,000 total and a contact kept separate from event facts.
> 4. Response quality still failed the visual bar. A later question contained literal escape
>    sequences and mojibake such as escaped German umlauts and a broken en dash. Questions
>    could contain multiple clauses and appeared bunched together. The final free-written
>    recap was far too long, repeated contact information, added caveats and invented a
>    reception detail that the customer had not supplied.
> 5. Local browser QA also discovered a separate credential-safety defect: when local
>    development chunks were blocked for the `127.0.0.1` origin, an unhydrated password form
>    fell back to GET and put fields in the URL. Auth forms now declare POST actions in HTML,
>    and local QA explicitly allows that development origin.
>
> ### Repairs made
>
> - Replaced the provider-facing property-per-fact extraction shape with a compact `facts`
>   list. Application code expands it into the existing rich `CateringRequest`, validates
>   enum/number/boolean values and preserves the internal data contract. A regression test
>   keeps the generated schema within Anthropic's union budget.
> - Added `normaliseModelText` at all model-prose boundaries used by extraction,
>   qualification, rework replies and knowledge prefixes. It performs bounded literal
>   Unicode decoding and only accepts a Latin-1-to-UTF-8 repair when a mojibake score
>   improves without creating replacement characters.
> - Tightened question generation and filtering: one field and one question mark per entry,
>   at most 280 characters, at most two questions, no filler/markdown/irrelevant recap, and
>   blank-line separation in the chat bubble. Bad entries fall back to deterministic field
>   wording rather than leaking awkward model text.
> - Removed the model-written ready-state recap. The customer now receives a compact bullet
>   summary built from the same typed rows as the request document. This also removes one
>   model call from the final turn.
> - Corrected acknowledgements so the assistant says it is collecting details for owner
>   review, not already assembling a quote, and shortened continuation acknowledgements.
> - Made login and signup safe before hydration with explicit POST form actions and allowed
>   the alternate loopback origin used by browser QA.
>
> ### Second live test — repaired customer and owner journey
>
> A new customer entered a 60-person corporate event in Cologne for 3 October 2027 with
> Fingerfood and contact details. The assistant asked two visually separated questions about
> delivery/on-site service and dietary needs. After the answer, it asked for exact venue and
> service duration. The third answer produced a grounded bullet recap and enabled send. The
> request was submitted successfully; the customer document excluded budget/contact, and the
> owner inbox showed Max Berger first with the correct contact, date, headcount, full venue,
> service, meal, fulfilment, duration, staffing, diet and inbound transcript. Browser console:
> **0 errors, 0 warnings**.
>
> The remaining visible NLP issue is semantic rather than character-level: `requestedItems`
> can retain a customer's full sentence even when typed fields already represent its service,
> fulfilment and staffing meaning. That produced a redundant `Gewünscht` row beside the
> normalized rows. Nothing false was added, but semantic deduplication/summarization should be
> evaluated before broad launch.
>
> ### Verification ledger
>
> - `npm run verify` — **passed**: TypeScript, ESLint, 48 test files, **600/600 tests**.
> - `npm run test:db` — **passed** in a fresh scratch database: all 17 migrations and all
>   signup, tenancy, invariant, request-link, retrieval and onboarding assertions.
> - `npm run build` — **passed**: optimized Next.js production build and all routes.
> - Live Anthropic diagnostic — **passed** after schema compaction; real structured extraction
>   returned valid typed data.
> - Customer Playwright journey — **passed**: three turns, correct Unicode and spacing,
>   deterministic recap, send, customer request document.
> - Owner Playwright journey — **passed**: login, inbox ordering and complete structured
>   request; browser console clean.
>
> ### What blocks an 8–10/10 experience
>
> 1. **Build a repeatable NLP eval, not more anecdotes.** Run at least 50–100 versioned cases
>    across German `Sie`/`du`, English, corrections, vague dates, pasted email signatures,
>    dietary edge cases, emoji/Unicode, injections and hostile budgets. Score field precision
>    and recall, unsupported facts, repeated questions, character corruption and ready-state
>    correctness. Keep live provider results separate from deterministic unit tests.
> 2. **Reduce completed-turn latency without lowering quality.** Benchmark Haiku/Sonnet for
>    extraction and question wording, test model routing, reduce repeated prompt tokens, and
>    consider combining or safely overlapping stages. Promote a cheaper/faster path only when
>    the eval is non-regressive. Keep the immediate acknowledgement.
> 3. **Persist assistant outbound turns.** The owner currently sees only customer messages,
>    so the exact questions that elicited an answer are absent from the handoff transcript.
> 4. **Normalize semantic duplication.** Preserve genuinely requested menu items while
>    suppressing prose that merely restates service style, fulfilment or staffing.
> 5. **Exercise production failure modes.** Measure retries, timeouts, rate limits, provider
>    unavailability, concurrent sessions and p95/p99 latency. Add automated real-browser smoke
>    coverage to CI and test on an actual narrow mobile viewport/device.
> 6. **Close commercial/operator inputs.** Production secrets, hosted EU PostgreSQL,
>    deployment/domain, verified legal operator fields and counsel-approved legal wording are
>    outside this local pass and still gate a broad public sale.
>
> ### How the claimed credits/perks fit the product
>
> Anthropic credits now fund the core extraction and qualification path plus a controlled live
> eval corpus; every model run already records purpose, model, token use, latency, cost and
> content hashes so a pilot can enforce spend and quality gates. The claimed hosting,
> database and storage perks should become separate preview and production environments: an
> EU-hosted Postgres instance for migrations and tenant data, managed secret injection for the
> rotated API key, application hosting with health/latency monitoring, and private object
> storage only for future assets that truly need binary retention. Credits reduce pilot cost;
> they do not replace provider configuration, data-processing review, backups, alerts or the
> launch eval above.

> ## ⚠⚠ THE SPEC PIVOTED ON 2026-08-09. READ THIS BEFORE ANYTHING ELSE.
>
> **The product is now: a customer builds a catering *request*; the caterer is the first
> party to attach money.** Vertical narrowed to catering, first customer is a caterer,
> price point €99.99/month. The plan of record is
> `~/.claude/plans/cryptic-growing-crystal.md`.
>
> **Most of this file describes the old spec** — hosted chat → AI prices from the
> catalogue → branded quote. Everything below the "State of the tree" section is still
> accurate about *what is built*, and increasingly wrong about *why*. Trust the plan file
> over this one wherever they disagree.
>
> ### What changed, in one paragraph
>
> The AI never quotes. It extracts a `CateringRequest` (no field for a price exists in the
> type or the output schema), asks until a caterer could actually answer, and hands the
> request over. The pricing engine did **not** leave — it moved to the *owner's* side, where
> it renders as a suggested price with a per-service breakdown and his profit margin. A
> wrong number in front of a customer is a lost deal; the same number in front of the
> caterer is a suggestion he overrules in three seconds.

> ## ✅ OFFERPROFI COMPLETION PASS — 2026-08-09
>
> The product now has a name and the previously missing owner surfaces are live:
> `/onboarding/uploads`, `/onboarding/brand`, `/datenschutz`, `/impressum` and the
> additionally discovered `/agb`. Uploads accept PDF/TXT, extract and chunk text, discard
> the original binary, de-duplicate per tenant and feed the existing sparse retrieval layer.
> Brand colour is persisted with a live accessible preview; a wordmark remains the safe
> fallback until logo storage is deliberately added.
>
> Owner onboarding was walked in a real browser from 2/5 to 5/5: brand confirmation, three
> document uploads, owner-review guardrails, root redirect and inbox. The customer chat's
> privacy and imprint links were also opened in-browser. The guardrail default now enforces
> the actual launch promise: the assistant qualifies and prepares a calculation, but the
> caterer approves every customer-facing price.
>
> `npm run verify`, `npm run test:db`, `npm run build` and `npm audit` are the release gates.
> The only missing input for the model-backed local flow is `ANTHROPIC_API_KEY`. A public
> deployment still needs ordinary operator inputs that code cannot invent: hosted EU
> PostgreSQL, production secrets/domain, the legal operator fields and counsel-approved
> legal wording.
>
> ### Done so far
>
> - **Phase A** — `src/domain/catering-request.ts` + `src/domain/extracted.ts`.
>   `src/agent/extraction.ts` retargeted. `event-brief.ts` keeps `EventBrief` untouched
>   because the golden-set-tested engine consumes it.
> - **Phase B (module)** — `src/agent/qualify.ts`. `readyToSend` computed in code, questions
>   written by the model, capped and filtered here, and no schema field by which it could
>   decline anyone.
> - **Phase B (wired)** — `src/chat/qualifying-turn.ts` + migration 0010. A customer's turn
>   now runs extraction and the qualifying loop on the same SSE connection and streams the
>   question back into the chat. See "The loop is wired" below for what that cost and what
>   it still needs.
>
> ### Next, in order
>
> 1. ~~Wire Phase B into the chat route.~~ **Done 2026-08-09.**
> 2. ~~**Phase D (web only)** — `/r/{token}`.~~ **Done 2026-08-09.** Two documents from one
>    route, the price-leak test written at both levels (rows and rendered HTML), and the
>    send button in the chat.
> 3. ~~**Phase E (owner side)** — the Unipile adapter.~~ **Done 2026-08-09.** Both
>    mitigations live in migration 0013 rather than in a runbook.
> 4. ~~**Phase B2** — the owner-side price suggestion.~~ **Done 2026-08-09.** Wrapping, not
>    editing: `ENGINE_VERSION` and the golden set are untouched.
> 5. ~~**Phase F** — `/inbox` and the onboarding rewrite.~~ **Inbox done 2026-08-09**;
>    the onboarding rewrite (upload → review facts → link WhatsApp) still waits on object
>    storage.
> 6. ~~**Phase C, the retrieval half**~~ — **built 2026-08-09 without pgvector.** See
>    "Phase C shipped without a vector database" below for what that cost and what is left.
>
> Deferred but now unavoidable: object storage (30+ PDFs, uploads, voice notes), and a small
> always-on worker container, because whisper.cpp and a model file cannot run in a serverless
> function.

> ## The loop is wired — 2026-08-09
>
> **A message now produces an answer written by a model.** `POST /api/chat/{slug}` streams the
> disclosure, the privacy line and the acknowledgement exactly as before, then a `working`
> frame, then the question. Extraction and the qualifying loop both run *behind* the first
> chunk, chained off the same persistence promise the route already had — one write, one
> inquiry, two consumers. The client needed no change: the typing indicator it already shows
> while `busy` covers the gap.
>
> **The one thing left before this is a demo:** `ANTHROPIC_API_KEY` is set nowhere, so
> `callModel` returns `not_configured`, the turn escalates, and the customer is told a person
> is taking over. That is verified behaviour, end to end against real rows — inquiry
> escalated, `automation_paused`, reason `extraction_not_configured`, audit row written. It is
> also not a pitch. Set the key.
>
> **Things worth not rediscovering:**
>
> - `messages.created_at` defaulted to `now()`, the *transaction* timestamp, so two messages
>   written in one transaction tied and "the last ten, oldest first" was an arbitrary order —
>   a scrambled conversation handed to the model. 0010 changes the default to
>   `clock_timestamp()`. Same mistake as the session-expiry one recorded further down, same
>   fix, found the same way: a database assertion that failed for a reason that looked wrong.
> - **`record_agent_progress` takes an outcome argument with exactly two legal values.** That
>   is Invariant 1 in a function signature rather than in a comment, and there is an assertion
>   proving a third raises. An escalated thread also cannot be pulled back to the agent — that
>   edge is legal for a human and would otherwise undo I5 one turn after it fired.
> - **Every failure inside a turn produces the same sentence to the customer** — a timeout, an
>   unparseable answer, a suspected injection, a write that would not go through. One line,
>   tested in all three voices to contain nothing that reads as a refusal. Varying it by
>   failure kind is how one of them eventually sounds like "no".
> - The agent stays quiet when triage routes to the owner's tray or the customer asked for a
>   human. Two model calls on a bot's behalf is the cost half of that; talking over the owner
>   is the I5 half.
> - Outbound turns are **still not stored.** The transcript sent to the model is the customer's
>   half only, which is consistent — but the caterer will eventually read this thread.

> ## ✅ RESOLVED HISTORICAL HANDOFF — what stood between this and a demo
>
> **This section records the corrected handoff that triggered the Offerprofi completion
> pass above. All four missing routes and the naming decision are now closed.**
> A correction was recorded because the previous version of this section was wrong.
> It claimed the API key was the only thing left. The *customer-side* flow — chat →
> qualify → send → two documents → the owner's inbox — is genuinely key-only, and every
> screen of it was walked end to end in a browser against real rows. **The owner-side
> onboarding flow is not.** Four routes 404, and three of them are linked from controls
> that are on screen right now:
>
> | 404 | Linked from | Why it matters |
> |---|---|---|
> | `/datenschutz` | **The chat, at first contact** — this is F1.13, the Art. 13 privacy link | The only gap here with a legal consequence rather than a cosmetic one |
> | `/impressum` | Chat footer, every conversation | §5 TMG |
> | `/onboarding/uploads` | The **"Angebote hochladen" button** on the checklist, and the signup page's own promise | Breaks onboarding step 1 |
> | `/onboarding/brand` | The **"Logo und Farbe" button** on the same checklist | Breaks onboarding step 4 |
>
> **Two more that were not named and should have been:**
>
> - **The product still has no name.** `{BRAND}` renders on `/signup` and `/login`. Open
>   question #1 has been marked blocking since before any of this work started, and four
>   sessions have walked past it. It is three environment variables (`src/lib/branding.ts`).
> - **Phase C has no UI.** The chunking, prefixing, storage and retrieval all landed and are
>   tested — and there is no screen to upload a document, so the whole layer is reachable
>   only from code. "Phase C is built" is true of the engine and false of the product.
>
> **A false alarm worth not re-investigating:** `/onboarding/guardrails` returns 500 in dev
> with `Cannot find module './vendor-chunks/@anthropic-ai.js'`. It is a stale dev chunk, not
> a defect — `rm -rf .next` and restart fixes it, the production build compiles clean, and
> this is the same family as the CSS-module quirk recorded at the bottom of this file.
>
> ### The former next-session list — completed
>
> 1. **`/datenschutz` and `/impressum`.** The privacy page needs counsel for the substantive
>    wording — that is open question #2 and engineering cannot close it. What engineering
>    *can* do is build the page with the factual processing description, which is derivable
>    from the schema (what is stored, where, which sub-processors, what is deliberately not
>    stored), and mark the rest as gaps rather than inventing legal text. **Do not fabricate
>    a Datenschutzerklärung.** A page with honest gaps beats both a 404 and a confident
>    fiction.
> 2. **`/onboarding/uploads`** — now cheap, because the ingestion pipeline landed
>    2026-08-09. Upload → parse to text → `chunkDocument` → `contextualisePrefixes` →
>    `ingestDocument`. All four exist and are tested; the screen is what is missing.
> 3. **`/onboarding/brand`** — a small form. Colour and logo; logo needs object storage, so
>    ship colour first and let the wordmark stand in, which is what the quote page already
>    does.
> 4. **Pick a name.**
>
> ---
>
> ## The API key — the final model-path input
>
> **`ANTHROPIC_API_KEY` is set nowhere.** Every screen below works and was walked in a
> browser against real rows, but two spots are model-gated and currently show their
> designed fallbacks rather than their real output:
>
> 1. **The qualifying question.** `callModel` returns `not_configured`, so the turn
>    escalates and the customer is told a person is taking over. Correct behaviour,
>    verified end to end — and not a pitch.
> 2. **The price suggestion** on the owner's `/r/{token}`. Service mapping is a model
>    call, so the block renders *"Zu dieser Anfrage passt noch keine Ihrer Leistungen
>    eindeutig"*. The engine, the margins and the rendering are all finished and tested;
>    nothing chooses the line items.
>
> Set the key and both light up in the local product. Public launch configuration and legal
> sign-off remain external operator work, not unfinished application routes.
>
> **To walk the flows:** `psql -d angebot_dev -f scripts/seed-demo.sql`, then
> `npm run dev`. Sign in as `johannes@krautundrueben.test` / `DemoPasswort2026!`,
> customer chat at `/a/kraut-und-rueben`.

> ## Phase C shipped without a vector database — 2026-08-09
>
> The three blockers were not one blocker, and two of them dissolved on inspection.
>
> **Object storage was never actually required.** It was on the critical path only because
> the plan assumed we keep 30 PDFs. We do not need the PDF, we need its text: parse at
> upload, chunk, discard the binary. That removes the bucket *and* the worker container from
> this path, and it improves the GDPR answer rather than weakening it — there is no document
> store to disclose, subject-access or delete. `source_name` is kept so a hit can say where
> it came from; a filename is not a file.
>
> **pgvector is a production provider constraint, not a local one** (`brew install pgvector`
> takes seconds; D29d already flags that not every managed Postgres offers it). So the dense
> half is deferred and the sparse half ships.
>
> ### What is built (migration 0015, `src/knowledge/`)
>
> - `knowledge_documents` + `knowledge_chunks`, with a **generated** `tsvector` over
>   `context_prefix || body_text` using Postgres' built-in **German** dictionary, GIN-indexed,
>   plus a trigram index on the raw body.
> - `search_knowledge()` fuses two rankers by taking the **greater** of `ts_rank_cd` and a
>   scaled trigram similarity — not the sum, so a chunk strong on one is not diluted by
>   scoring zero on the other.
> - `chunkDocument()` splits on paragraphs first, sentences second, characters only as a last
>   resort. Each fallback is worse than the one before, so each is reached only when the
>   better one cannot apply.
> - `contextualisePrefixes()` — **one model call per document, not per chunk**, with the whole
>   parent document in context. This is the part of Contextual Retrieval that does the most
>   work and it needs no pgvector.
> - Retrieval is wired into the qualifying turn beside the confirmed facts.
>
> ### The golden set, and why it is SQL
>
> Five cases in `db/tests/tenancy.sql`, not vitest — **the ranking *is* SQL, so a TypeScript
> test would assert against a mock of the thing under test.** They pass:
>
> 1. German stemming finds "Hauptgängen" in a chunk saying "Hauptgänge".
> 2. **A chunk is found by a word that appears only in its prefix.** The staffing chunk never
>    says "Hochzeit"; without the sticky note it is unfindable. This is the whole thesis of
>    Contextual Retrieval, demonstrated.
> 3. Trigram bridges "Paella-Station" → "Paella Station", which shares no lexeme.
> 4. An unrelated question ("Feuerwerk Drohnenshow") returns **nothing**, not the least-bad
>    chunk. A confidently irrelevant snippet is worse than silence.
> 5. F0.4 — the definer is scoped by its argument and nothing else.
>
> ### Honest about the gap
>
> Hybrid dense + sparse with reranking is better than sparse alone; that is not in dispute
> and this is not a claim that it does not matter. Two things make it a smaller compromise
> than it sounds. The corpus is ~30 documents of one caterer's German food writing, where
> stemmed keyword + trigram is genuinely competitive — dense earns its keep on large
> heterogeneous corpora. And **the expensive-to-get-wrong pile is not in here at all**:
> prices, minimums, radius and payment terms are `agency_facts`, structured rows he confirmed,
> read as data and never ranked. Retrieval only handles "how does he describe his food", where
> a mediocre hit costs a generic question rather than a wrong promise.
>
> ### Adding dense later
>
> `alter table knowledge_chunks add column embedding vector(1024)`, add cosine distance as a
> third ranker, switch `search_knowledge` to Reciprocal Rank Fusion. **Nothing above that
> function changes** — which is why retrieval is a database function and not a query in
> TypeScript. The column is deliberately absent rather than nullable-and-unused, so "is dense
> on?" is answered by the schema instead of by a flag.
>
> **A rerank pass is also unblocked** and not yet built: top-20 sparse → one model call →
> top-5. It needs the API key, not pgvector, and it recovers a good part of what dense would
> have given. That is the highest-value next thing in this layer.

> ## Phases B2, E, F and C-structured — 2026-08-09
>
> ### B2 — the same engine, rendered to the caterer
>
> `priceQuote` is called exactly as it always was; what changed is who reads the answer.
> `src/engine/margin.ts` **wraps** `PricedQuote` and cannot produce a price, so a margin bug
> can never become a pricing bug and the golden set is untouched.
>
> - **The test that matters is `revenue === quote.netTotal`.** The tempting
>   `revenue − cost === margin` restates the implementation and passes even if the wrapper
>   reads the wrong field off every line.
> - **A missing cost is unknown, never zero.** Zeroing would report un-costed lines as pure
>   profit — always wrong in the flattering direction, on the screen where he decides whether
>   an event is worth doing. Excluded and named instead.
> - `requestToPricingInput` is a **second door into `PricingInput`**, so the I2 test now
>   inspects it too. A rule enforced on one of two entry points is not enforced.
> - The suggestion is **recomputed per view**, never stored: his catalogue may have changed
>   since she sent, and a cached figure shown as today's suggestion is the one way this
>   misleads him.
>
> ### E — WhatsApp, and the two mitigations
>
> The provider is unofficial (N3). What that decision costs is paid in the schema:
>
> - `first_inbound_at` is written by the webhook and by nothing else. `may_send_to_thread`
>   refuses a thread that has none. **No `force` parameter exists, and no internal variant
>   skips the gate.**
> - A per-account daily cap on *new threads* — not messages; a long conversation with one
>   customer is not the pattern that gets a number banned — plus a kill switch. Both are
>   columns, asserted by flipping the switch from a psql prompt.
> - The owner's own thread is exempt from the cap. He linked the account.
> - `rework.ts`: every figure in the draft must be one he wrote, checked **in code** over the
>   rendered message. 78 × 80 = 6,240 is correct arithmetic and still a violation.
>
> ### C — the structured half only
>
> Confirmed facts are read as data and rendered verbatim; the retrieval half is not built.
> **The most fragile point in the product is here:** "Mindestbestellung ab 20 Personen" plus
> an enquiry for 12 is the most natural-sounding refusal software could produce, and a model
> would produce it helpfully. The instruction forbids it in as many words and a test keeps
> that sentence there.
>
> ### What is left, and why
>
> | Not built | Blocked on |
> |---|---|
> | ~~Contextual Retrieval~~ | **Built without pgvector — see below.** The dense half remains deferred |
> | Object storage (F0.5) for **retaining original files**, crawl, BrandProfile | S3-compatible bucket, EU region (D29b). **No longer blocks the knowledge layer** |
> | Voice notes | whisper.cpp cannot run in a serverless function — needs the same worker container |
> | PDF of the request document | Headless Chrome; the web document is the source of truth and already prints |
> | Onboarding rewrite | Waits on object storage — the first step is "upload 30 offers" |
> | Outbound message persistence | Still only the customer's half of the transcript is stored |
>
> **Nothing above is stubbed or faked.** Each one renders its real empty state.

> ## The loop closes — Phase D, 2026-08-09
>
> **She presses send, and two documents exist.** `POST /api/chat/{slug}/send` mints two
> unrelated tokens, stores their hashes, walks the inquiry to the new `sent_to_owner` state
> and returns hers. `GET /r/{token}` renders whichever document the token belongs to.
>
> **The price-leak rule is enforced in three places, deliberately:**
>
> 1. `resolve_request_link` returns `contact_json` **only for the owner's audience**. Her
>    document is built from a row with nulls in those columns, so the component cannot leak
>    what it was never handed. **Phase B2's price block goes in exactly this place.**
> 2. `requestRows()` drops `MONEY_FIELDS` for the customer audience — the budget she
>    mentioned is information *for him*, and echoing it back to her on a forwardable document
>    buys nothing while making the rule a judgement call.
> 3. `tests/requests/document.test.tsx` renders both copies and greps the HTML: no `€`, no
>    `EUR`, no `6.000`, no invoice vocabulary, no contact details. Written against the output
>    rather than the props because the realistic B2 regression is a conditional that renders
>    for both audiences — a props check would not notice.
>
> **Send never refuses.** Not for a thin request, not for low confidence, not for an escalated
> thread. "Your enquiry is not complete enough to send" is software turning a customer away.
> Completeness decides what the assistant *asks*, never what she is allowed to do — verified
> live against an escalated inquiry, which sent fine.
>
> **Things worth not rediscovering:**
>
> - **`sent_to_owner` is a new enum value**, and it is reached by *her*, not by the agent —
>   which is why `record_agent_progress` still has exactly two outcomes. Adding it meant
>   restating `enforce_inquiry_transition` in full (0011); a partial redefinition silently
>   drops every row it does not mention.
> - A function with an OUT parameter named `state` cannot say `where state = 'new'` — the
>   name resolves to the variable. Alias the table.
> - **RLS bites inside the tests too.** Counting `request_links` from the `app_login` seat
>   returns zero for the right reason and proves nothing; those assertions have to run after
>   `reset role`. Same for revoking a link. This cost two round trips.
> - **A sent request with no extraction still has a document**, showing the empty state rather
>   than a 404. Without an API key that is every request, and a 404 would tell her the enquiry
>   she just sent does not exist.
> - The owner's copy does not carry the customer's *freibleibend* sentence — it is addressed
>   to "Ihnen" and would be talking to the wrong person. His half of the same fact is that
>   nothing was quoted to her, so he is free.
> - The owner's link is currently a structured server log line (`request_ready_for_owner`).
>   Phase E replaces it with the WhatsApp message; `/inbox` (Phase F) makes it findable.
> - **Unverified without the key:** the send *button* appears on the `ready` SSE frame, which
>   only fires when the model says the request is complete. The endpoint behind it is verified
>   by curl end to end; the button itself has never been on a screen.

> ## ⚠ If you are a new session, read “▶ PICK UP HERE” before touching anything
>
> **The priority changed on 2026-08-09 and it overrides the phase order in
> CLAUDE.md §10.** Build only what a customer or a judge can see on a screen.
> There are **five numbered steps** in that section — start at step 1 and work down.
> Anything invisible at a demo is explicitly not this week's work.
>
> Pitch is **14 Aug 2026**. The reasoning is in that section; do not re-derive it.

**Where the build actually is:** Phase 1 complete. Phase 0 at 50% and Phase 4 at 80% —
both were previously recorded here as "complete" and neither was; see
[BUILD_STATUS.md](BUILD_STATUS.md). Phase 2 is half built. Run `npm run progress` for a
generated view (`docs/progress.html`) — **33% of 154 features**, derived from the
inventory rather than typed by hand, so it does not drift.

**The one number that matters more than that one:** ~~there is no model call anywhere in
the product~~ — **step 1 is closed.** F0.11 shipped on 2026-08-09: `src/agent/client.ts`
is the product's only door to a model, and nothing yet walks through it. The headline
promise still is not demonstrable, because nothing extracts an event from a
conversation. **Step 2 is next.**

See [EVAL.md](EVAL.md) for how to tear this down and judge it on evidence. Its section
0 is still the uncomfortable one: nothing here has met a real agency yet.

Read [CLAUDE.md](../CLAUDE.md) first, then [PRODUCT_SPEC.md](../PRODUCT_SPEC.md), then
[BUILD_STATUS.md](BUILD_STATUS.md) for the feature-by-feature account. This file is the
short version: where the work stopped, and what to pick up.

---

## State of the tree

```
npm run verify     typecheck + lint + 580 tests         green
npm run test:db    15 migrations + 2 assertion suites   green   (needs local Postgres)
npm run build      production build                     clean
```

`npm run test:db` builds a scratch database; it does **not** touch `angebot_dev`. A new
migration has to be applied to the development database by hand:
`psql -d angebot_dev -f db/migrations/00NN_….sql`. Forgetting that is a function that
exists in every test and in none of the browser runs.

Four commits, all of Phase 0/1/4 and half of Phase 2 committed.

### The thing that changed most this session

**There is a real database now.** `./db/dev-setup.sh` creates `angebot_dev` and the
`app_login` role, and `.env.local` points at it. That role inherits `app_user`, which is
`NOLOGIN NOBYPASSRLS` — so development runs under the same row-level-security
constraint as production. Connecting as the database owner instead would silently
disable every policy in the product while all the tests still passed.

Everything below was therefore verified in a browser against real rows, not only in
unit tests.

### What runs today

| URL | What it does |
|---|---|
| `/signup` | Creates a real tenant. Live slug preview, collision suggestions |
| `/login` | Indistinguishable on failure, timing-equalised, exponential backoff |
| `/` | Router, not a page — sends an owner to onboarding or the inbox by her state |
| `/onboarding` | Progress against the real Phase 2 exit criterion |
| `/onboarding/catalogue` | Build the whole catalogue by hand |
| `/onboarding/guardrails` | All the guardrails that do not need a calendar |
| `/a/demo` | Hosted chat — disclosure, ack, DE/EN, Sie/Du |
| `/q/demo` | Web quote, priced by the real engine |

`CHAT_SESSION_SECRET` and `DATABASE_URL` must both be set. `.env.local` has development
values and is gitignored.

---

## Built this session

**F0.6 owner auth.** scrypt hashing with self-describing parameters (raise the cost
later without invalidating existing hashes; upgraded silently on next login).
Database-backed staff sessions in their own module with their own cookie — revocation
is the whole reason the table exists, because someone leaving a three-person agency
has to lose access that afternoon. Login is indistinguishable on failure and verifies
against a dummy hash when the address is unknown, so the form is not an
account-enumeration oracle. **Measured at ~201 ms either way in the real request path.**

**F0.7 tenant bootstrap.** One `SECURITY DEFINER` function writes user, agency, owner
membership and slug reservation atomically; a database assertion proves partial success
is impossible. Slug derivation transliterates rather than strips, so `Schröder` becomes
`schroeder` — the string ends up on a business card. A collision returns three free
alternatives, which is the acceptance criterion: a suggestion, never an error page.

**S9 onboarding shell.** A checklist, not a wizard. The steps have genuinely different
costs, and an owner blocked behind one she cannot do right now abandons rather than
skipping ahead.

**F2.9 / F2.11 catalogue by hand.** Closes open question #5 — an owner whose extraction
goes badly is never stuck, because this path never depended on extraction. List and
editor share one surface; the form keeps driver, unit and VAT between saves because an
agency's services cluster.

**F2.13 guardrails.** Nine of the twelve settings, grouped into three questions an owner
actually has. The other three are calendar work (F4.11) or need Phase 10 channels. All
pre-filled, so the three-minute budget is spent on the two she wants to change.

**F4.3 Staffelpreise on S17.** The form asks one number per band — "ab 50 Personen" —
and derives every upper bound from the next band up, so a hand-built ladder cannot gap
or overlap. A band under the item floor is refused at entry, because the engine clamps
it up to the floor and prices correctly, which means she would otherwise see a price she
never set on every quote with nothing to explain it.

**F1.4 public slug resolution.** `/a/{slug}` resolved to nothing for every real tenant —
the chat link an agency is told to put in its Instagram bio 404'd. Now a SECURITY
DEFINER function with a fixed stranger-visible column list, so a later `alter table` on
`agencies` cannot quietly join the public API. Suspended and nonexistent are the same
empty answer, because the slug is guessable and distinguishing them would enumerate the
platform's whole customer list.

**F1.1 / F1.5 / F1.8 chat persistence.** The oldest gap, closed. One function writes the
inquiry, message, `chat_sessions` and `disclosure_records` rows, because a message with
no inquiry is unreachable and a session pointing at neither loses the thread on refresh.
Replay is a no-op via the unique index rather than a check. It runs **behind the first
streamed chunk**, never in front of it, so a slow database cannot move the F1.9 metric.
Outbound turns are still not stored — the transcript holds only the customer's half.

**`npm run progress`.** Generates `docs/progress.html` from FEATURE_INVENTORY.md against
BUILD_STATUS.md. Deriving the number instead of typing it immediately falsified two
claims this file had been making: Phase 0 and Phase 4 were both recorded as complete and
neither was.

---

## Bugs found, and how

Worth recording because the *method* mattered more than any individual fix.

**Found by looking at the rendered screen, not by a test:**

- The progress model treated a target of zero as met, so a brand-new owner with no
  services was told she had already completed "a price for every service", and the
  counter claimed 1 of 5. Arithmetically true; wrong in front of a person, on the first
  screen of the flow the ≥70% completion target depends on. Requirements now carry
  `blocked`, and the test that encoded the old behaviour was replaced.
- The signup URL preview was an inline `<span>`, so a wrapped URL broke its background
  into ragged per-line fragments.
- `formatEuroInput` rendered €5,000 as `5000,00` next to a placeholder reading
  `5.000,00`, making the two look like different kinds of number.

**Found by tests:**

- A zero list price also fired the floor comparison, so the owner was told her floor was
  above the list price — about the one field she had typed correctly.
- `Number('')` is `0` and `0` is a valid VAT rate, so an unanswered VAT field silently
  zero-rated an item. That mistake first surfaces on an invoice.

**Found by running the migration:**

- Session expiry used `now()`, the *transaction* timestamp, which does not advance while
  a transaction runs — so a session that died mid-request still resolved. Now
  `clock_timestamp()`.

**Found by typecheck:** the repository restated the `QuantityDriver` and `VatRate`
unions instead of importing them, and the copy was already missing `per_day` within an
hour of being written.

---

## ▶ PICK UP HERE — read this section before anything else

**Priority changed on 2026-08-09, by the owner, and it overrides the phase order in
CLAUDE.md §10 for the next five days.**

### The rule now

> **Build only what a customer or a judge can see on a screen.**
> If a feature cannot be pointed at during a live demo, it is not this week's work —
> however correct, however overdue, however tempting.

Everything shipped so far is real and none of it is wasted, but the build went deep on
things nobody can see — RLS, invariants, tenancy assertions, gapless numbering, session
revocation — and thin on the one sentence the product is sold on:

> *"Vom Chat zum verschickten Angebot in unter 5 Minuten."*

**That sentence is currently not demonstrable.** There is no model call anywhere in the
product (F0.11 not started), so nothing extracts an event from a conversation, nothing
maps intent to catalogue items, and no quote is ever produced from a chat. The engine
that would price it is finished and golden-set tested; the wire into it does not exist.

### Why, in one paragraph

The build is for **SummerUP** (CODE University Berlin, 7–14 Aug 2026, pitch on the
14th). The event's own requirement is *"MVP with paying customers before the final
pitch"*, its methodology is *"sell before you build"*, and its stated mandate is *"stop
building things nobody wants"*. The 2025 winner reached €127.8k pipeline and 8 LOIs;
the runner-up took 3 paying customers at €500 **during the week**. Judges reportedly
reward validation rigour over polish. A row-level-security policy cannot be shown to a
wedding planner and will not appear in a pitch. A chat that turns into a branded,
correctly priced Angebot in ninety seconds will.

---

### The five steps, in dependency order

Do them in this order. Each one is visible on a screen, and each is the precondition
for the next. **Step 5 is the pitch demo**; steps 1–4 exist to make step 5 real.

#### 1. F0.11 — the Anthropic client wrapper ✅ **done 2026-08-09**

The gate on everything below, and now open.

`src/agent/client.ts` is the only file in the product that may import the SDK. Two
enforcements, because one is not enough: a `no-restricted-imports` rule in
`eslint.config.mjs`, and `tests/agent/boundary.test.ts`, which walks `src/`, `tests/`
and `scripts/` and fails if a second file mentions the package. The lint rule only
sees import statements, and a boundary checked only by a linter is a boundary checked
only when someone runs the linter.

What hangs off that boundary, and would be skipped one call site later:

- **`agent_runs` on every call, failed ones included** (`db/migrations/0008`,
  SECURITY DEFINER — the caller is a customer and has no identity). A call that timed
  out still burned input tokens, and a month of those is exactly what would otherwise
  never appear in the unit economics. This is the row open question #3 gets answered
  with. It stores content **hashes**, never prompt or completion text: the message is
  already in `messages`, and a second copy with a different retention story buys
  nothing.
- **Cost in integer micro-cents** (`src/agent/cost.ts`). $5/M tokens is 0.0005 ¢ per
  token — a figure that does not survive being summed ten thousand times as a float.
  Rates are integers chosen so the cache multipliers (0.1×, 1.25×) stay integers too,
  and the total is rendered to a decimal string exactly once, at the database
  boundary. A model missing from the table costs `null`, never a guess.
- **Customer content framed as data** (`src/agent/prompt.ts`, F3.11). Untrusted text
  goes in labelled `<untrusted_input>` blocks with every `<` escaped, so no string a
  customer can type closes the block early. `buildPrompt` takes the trusted role and
  instruction as different parameters from the untrusted documents — concatenating one
  into the other is not something a caller does by forgetting.
- **Invariant 1 in the type system.** `callModel` does not throw. Every outcome is
  `{ ok: true }` or a failure carrying `escalate: true`, and no failure kind means
  "decline this customer". A throw would surface as a 500 on the chat surface, which
  reads to a bride as *this agency's system rejected me*.

Also here: D17's zero-retention requirement is an account setting, not a request
parameter, so what the code can assert is that no model ineligible for it is
reachable — `claude-fable-5` is refused by the registry with the reason named.

#### 2. F3.3 / F3.5 — extraction: a chat turn becomes an `EventBrief` ✅ **done 2026-08-09**

`src/agent/extraction.ts`. The types were already built and tested — `EventBrief`
(F3.1), the `_contact` partition (F3.2), the confidence table (F3.6) — and this is the
call that fills them in.

What the model decides: which fields the customer stated, what each holds, how sure it
is, and which message it came from. What it does not decide: whether that is good
enough to send (`evaluateConfidence`, in code), what anything costs (the engine), what
language the conversation is in (`detectLanguageAndFormality`, already deterministic
and tested), or whether the inquiry proceeds — nothing decides that.

- **Completeness and overall confidence are computed, not asked for.** A model's
  estimate of its own reliability is not a measurement, and these two numbers are the
  gate on sending a quote unattended.
- **An invented service id is discarded** (D8). The model is given the agency's own ids
  and told not to substitute a similar one; anything not in the catalogue is dropped
  before it reaches a brief, and dropped from the provenance rows too, so it cannot
  reappear as the justification for a line item that was never quoted.
- **`extractions` rows append, never overwrite** (migration 0009). "80 until message
  four said 95" is the history the conflict rule in §4.10 is written against.
- **An owner's correction survives a later model run.** `mergeExtracted` was already
  there; `mergeBrief` uses it field by field, and silence in a later turn is not
  retraction.
- **F3.11 is reported, not obeyed.** `injection_suspected` escalates, changes no other
  field, and refuses nobody — Invariant 1 has no exception for a rude message.
- **I2 survives the round trip**, and a database assertion proves it: brief and contact
  go in as two arguments, through two parameters, into two columns. A test serialises
  the whole brief and searches it for the customer's name, because the realistic way
  this breaks is a name smuggled into `location`.

**Not yet wired into the chat route.** Nothing calls extraction when a turn arrives —
that lands with step 3, at the point where it produces a quote a customer can open.

#### 3. `EventBrief` → `PricingInput` → a stored quote version

The engine is done, pure and reproduces the golden set to the cent. This step is the
join, not new arithmetic — **do not write a second pricing path.**

- Map extracted services to catalogue item ids. The model chooses ids; **all arithmetic
  stays in code** (D6).
- Call `allocate_quote_number()` — it exists in the schema (F5.1) and has never been
  called from application code.
- Store the `quote_versions` row **with its full `calculation_trace`**, so any figure
  can be explained on request. That is I6, and it is also the single most convincing
  thing to show a judge who asks "how do you know this number is right?"

**Two things this step needs that do not exist yet, found while building step 2 —
do not rediscover them:**

1. **A catalogue read with no identity.** `listCatalogueItems` in
   `src/onboarding/repository.ts` is user-scoped, and correctly so: it is the owner's
   editor. Pricing runs in the customer path, where there is no user, so this needs a
   third definer function in the shape of 0007/0008/0009 — something like
   `catalogue_for_pricing(agency_id)` returning items, price rules and modifiers.
   Give it a fixed column list for the same reason `public_agency_profile` has one.
2. **A quote writer with no identity**, wrapping `allocate_quote_number()` (0003) and
   the `quotes` / `quote_versions` insert in one call, because a quote row with no
   version is an empty link and a version with no number cannot be sent.

`toPricingInput(brief, availability)` already exists in `src/domain/pricing-input.ts`
and already drops everything personal. **Do not write a second one**, and do not add a
parameter to it that takes a contact — that type not having one is Invariant 2.

The chat route (`src/app/api/chat/[slug]/route.ts`) is where extraction gets called,
behind the acknowledgement, never in front of it. Note the shape it has to fit:
`recordChatTurn` returns the inquiry id, but `recordChatTurnDetached` — the version
the route uses — throws it away to keep the write off the F1.9 path. Extraction needs
that id, so the wiring has to chain off the same promise rather than start a second
one, and it still must not move the first chunk.

#### 4. F5.3 — a real tokenised quote link, sent into the chat

Today `/q/{token}` renders one hardcoded demo quote and **404s for every real token**
(`src/app/q/[token]/page.tsx`). This is the step that produces the demo's payoff moment.

- Resolve the token against the stored quote version. A bad token renders a neutral
  not-found — never a hint that some other token would have worked.
- Post the link into the conversation as an agent turn, so the customer sees the quote
  arrive **inside the chat she is already in**. That is the "under 5 minutes" claim,
  visible, on one screen, without a tool switch.
- The quote page itself is already built and good (F5.2): branded, responsive, print
  stylesheet, *freibleibend* clause, Art. 50(2) marking. It needs real data, not work.

#### 5. F5.7 + a minimal `/inbox` — accept, and hand off to the owner

The accept / decline / request-human buttons **render and do nothing**, and `/inbox`
**does not exist**, so an owner who completes onboarding is redirected by the root
router to a 404. Both are visible failures in a demo.

- `POST /q/{token}/accept` (D10) — the explicit click that hands a qualified request to
  the owner. Nothing binding is created; the owner still confirms (I3, I4).
- A single screen listing inquiries with their state, the brief, and the quote. It does
  not need to be the full Phase 6 dashboard — it needs to prove the loop closes and the
  human is in the path.

**When step 5 works, the whole pitch is one unbroken screen recording:** open the chat
link → describe a wedding → watch a branded Angebot arrive → accept it → see it land on
the owner's desk.

---

### Explicitly NOT this week

Not because they are wrong — several are genuinely overdue — but because none of them
is visible at the pitch, and the week is five days long.

| Deferred | Why it can wait |
|---|---|
| Object storage (F0.5) and everything behind it — bulk upload, crawl, BrandProfile, S13 | The catalogue is buildable by hand (F2.9/F2.11), so onboarding already completes without it |
| Calendar sync (F4.9–F4.12) | The product works fully uncalendared, and that is a tested guarantee |
| Outbound message persistence | The transcript holding only the customer's half is invisible on stage |
| Email verification, password reset, alias inbound (Phase 7) | Needs outbound email; the signup screen already says so honestly |
| Slack, Gmail, WhatsApp (Phases 10–12) | Roadmap-committed, gated on third-party review, and irrelevant to a demo |
| **More compliance depth** | **Freeze it.** See below |

### On the invariants — freeze, do not remove

The six invariants (CLAUDE.md §2) and their 39 tests **stay exactly as they are.** They
are locked decisions, they are a real differentiator in a DACH B2B sales conversation,
and removing one to move faster would be the one change that cannot be undone later.

But **stop adding to that layer.** It is finished enough. The correct use of the
compliance work this week is to *say it in the pitch*, not to build more of it: no
automated refusal is structurally possible, no personal data reaches pricing, every
figure is reconstructible. That is a slide, and it is already true.

---
## Open questions this session did not resolve

1. **The product name is still blocking**, and it is now the single most visible
   placeholder: `chat.example.invalid/a/lisa-meier-hochzeiten` appears on the owner's
   own onboarding screen, with a warning that it will not work until the domain is set.
   Closing it is an edit to three environment variables (`src/lib/branding.ts`), and a
   test asserts no candidate name is hardcoded anywhere.
2. **SLA wording (§9.8).** `slaHours` is still a per-agency field with no UI. Who sets
   it, and what happens when it is missed?
3. **Chat conversion rate (§9.6)** — still the load-bearing unknown.
4. **~~Manual-catalogue fallback (§9.5)~~ — closed.** F2.11 is built; an owner whose
   uploads extract badly completes onboarding by typing.

---

## Things a future session should not undo

- **The demo-first priority in "▶ PICK UP HERE".** It was set deliberately by the owner
  on 2026-08-09, against a fixed external deadline, and it is the reason the phase order
  in CLAUDE.md §10 is being ignored. If you find yourself about to build something
  invisible because the phase list says so, that is the thing this note exists to stop.
  It expires after the 14 Aug pitch, not before, and only the owner retires it.
- The six invariants in CLAUDE.md §2, and their tests. **Frozen, not relaxed** — keep
  every one, add nothing to that layer this week.
- **The two rate limiters are deliberately different types.** `src/chat/rate-limit.ts`
  guards the customer surface and has no variant that can express a refusal — that is
  Invariant 1 in the compiler. `src/auth/throttle.ts` guards our own front door and does
  refuse, which is correct: I1 protects the agency's customers, not anonymous strangers.
  Merging them turns a guarantee into a convention.
- **The guardrail copy is tested.** `minOrderValue` is refusal-shaped, and an owner who
  believes it declines small jobs will configure her business around a behaviour that
  cannot happen. A test asserts the German wording never promises one.
- Login backs off exponentially rather than locking out — a lockout would let anyone who
  knows an owner's email keep her out of her own dashboard.
- The adapter contract staying a pure function. Phase 12's exit criterion depends on it.
- Case-sensitive Sie detection.
- Zero third-party origins on `/a/*`, `/q/*`, `/f/*`.

## A development quirk worth knowing

Adding a new CSS module while `next dev` is running leaves the server serving 404s for
its own chunks, and the page renders completely unstyled. It is not a CSS bug and not
worth debugging — `rm -rf .next` and restart. It cost two round trips this session
before the pattern was obvious.
