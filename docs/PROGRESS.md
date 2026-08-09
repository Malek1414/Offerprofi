# Progress and session handoff

**Updated:** 2026-08-09 · **Phase 0 complete. Phase 1 complete except persistence.
Phase 4 complete. Phase 2 is half built — everything that does not need object storage
or a model call now works end to end against a real database.**

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

## Pick up here

### 1. The rest of Phase 2 — needs object storage first

F2.1 bulk upload, F2.2 per-format workers, F2.4 crawl, F2.5 BrandProfile, F2.7
QuotePattern, and screen S13 (per-object confirm/edit/reject with source excerpts, the
hardest screen in the product). **All of it is blocked on an S3-compatible bucket in the
EU (F0.5, D29b).** Reuse `src/chat/uploads.ts` — the sniffing and the scan gate are
already written and tested; do not write a second upload path.

### 2. Staffelpreise have no UI

`price_rules` is modelled, migrated, read by the engine, and `replacePriceRules` is
written — but screen S17 exposes only the single unit price. An owner who prices per
head in bands cannot express that yet. Small, self-contained, and needs nothing new.

### 3. Phase 1 persistence

Still the oldest outstanding gap. Every insertion point is marked
`TODO(Phase 1, database)` in `src/app/api/chat/[slug]/route.ts` and `src/lib/agency.ts`.
Now genuinely unblocked, because the database exists: resolve the slug against
`agency_slugs`, upsert the inquiry, insert the message idempotently on
`external_message_id`, write the `chat_sessions` and `disclosure_records` rows.

### 4. Email verification and password reset

Both need outbound email (Phase 7). Until then signup trusts the address as typed and
an owner who forgets her password has no self-service route back in. The signup screen
says so rather than implying otherwise.

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

- The six invariants in CLAUDE.md §2, and their tests.
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
