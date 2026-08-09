# Progress and session handoff

**Updated:** 2026-08-09

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
generated view (`docs/progress.html`) — **30% of 154 features**, derived from the
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
npm run verify     typecheck + lint + 349 tests        green
npm run test:db    5 migrations + 2 assertion suites   green   (needs local Postgres)
npm run build      production build                    clean
```

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
