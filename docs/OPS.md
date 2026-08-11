# Ops — deployment, the sidecar, and what n8n is allowed to do

> Phase E of [EXECUTION_HANDOFF.md](EXECUTION_HANDOFF.md). Written down because the
> two decisions in §3 and §4 below are the kind that get quietly reversed by whoever
> is next fixing something at eleven at night.

---

## 1. The shape

```
                    ┌──────────────────────────────┐
   customer ───────▶│  Next.js container           │
   owner    ───────▶│  (Sliplane, EU region)       │
                    └──────┬──────────────┬────────┘
                           │              │
                  hard     │              │  soft — may be down
                dependency │              │
                           ▼              ▼
                ┌────────────────┐  ┌──────────────────┐
                │ Postgres 15+   │  │ Cognee sidecar   │
                │ EU region      │  │ shared layer     │
                │ RLS, pgvector  │  │ no price/brand/  │
                │ (D15, D29)     │  │ person (D31)     │
                └────────────────┘  └──────────────────┘
                           ▲
                           │ observes only
                    ┌──────┴───────┐
                    │     n8n      │
                    └──────────────┘
```

Two dependencies, and they are not the same kind. Postgres is hard: without it the
product does not run, and it should not pretend to. Cognee is soft by construction
— §4 of the handoff requires that a shared-layer outage degrades to baseline
extraction rather than stopping anything, and `src/shared-layer/cognee.ts` returns
a typed `unavailable` instead of throwing so that this is true in code and not just
in a diagram.

---

## 2. The container

`Dockerfile` is three stages. The build needs the toolchain and the full
dependency tree; the thing that runs in production needs neither, and shipping one
stage would put the compiler and every devDependency on a public host. `output:
'standalone'` in `next.config.ts` is what makes the runtime stage small.

It runs as `nextjs` (uid 1001), not root.

### Health

`GET /api/health` does a `select 1`. This matters more than it looks: a TCP probe
passes for a Node process that is listening and has lost its connection pool,
which is the most likely way this product is actually down. The orchestrator would
keep routing customers to a container answering every request with an error, and
nothing would restart it.

It reports `ok`, `degraded` or `unconfigured` and nothing else. The endpoint is
reachable from the internet, and a health check that names the failing host or
quotes a driver error is free reconnaissance.

---

## 3. The database connection — the one that has cost time before

**Do not connect as the database owner.**

`DATABASE_URL` must point at a role that inherits `app_user`, which is `NOLOGIN
NOBYPASSRLS`. A role with `BYPASSRLS` — the owner, typically, and the default in
most managed-Postgres quickstarts — silently disables every one of the RLS
policies in the product **while every test still passes**, because the tests
create their own `app_login` role and use that.

The failure mode is a cross-tenant data leak with no error anywhere. There is
nothing to notice.

```sql
create role app_login login inherit password '…';
grant app_user to app_login;
```

### Migrations

`db/test.sh` applies every migration to a scratch database and runs the assertions
in `db/tests/`. It does not touch a real one.

**A new migration must be applied to each real database by hand:**

```bash
psql -d angebot_dev  -v ON_ERROR_STOP=1 -f db/migrations/00NN_….sql
psql "$DATABASE_URL"  -v ON_ERROR_STOP=1 -f db/migrations/00NN_….sql
```

Tests pass on a scratch database while the browser fails, and that gap has cost
this project time more than once.

---

## 4. n8n observes; it does not orchestrate

The handoff is explicit and it is worth restating with the reason attached.

**What n8n may do:** fire on candidate-confirmed and recompute the C5 metric. Send
a notification. Anything whose failure nobody would notice within a day.

**What n8n may not do:** sit in the path of an inquiry, a quote, a crawl or a
model call. The enrichment queue lives in Postgres (`enrichment_jobs`, migration
0021) precisely so that the thing which decides what work happens next is the same
thing that stores the work — one system, one transaction, one place to look when a
job is stuck.

The reasoning is not aesthetic. A crawl that stops because a workflow tool is down
is a crawl nobody can reason about: the state is split across two systems that
cannot see each other's transactions, and "why did this prospect never get
enriched?" becomes a question with no answer in either. Moving orchestration into
n8n would also put a third party in the path of customer data, which is the
opposite of the §7 posture that treats a minimal footprint as a selling point.

---

## 5. Environment

Everything in `.env.example`, plus:

| Variable | Required | If missing |
|---|---|---|
| `DATABASE_URL` | **yes** | The app refuses to start. Must inherit `app_user` — see §3 |
| `CHAT_SESSION_SECRET` | **yes** | ≥32 random characters |
| `ANTHROPIC_API_KEY` | **yes** | Extraction and qualifying escalate to a human instead |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | **yes in production** | `objectStore()` throws at startup rather than falling back to the filesystem. Deliberate: a container filesystem is erased on redeploy, so a fallback means uploads that report success and are gone by morning |
| `TAVILY_API_KEY` | no | Enrichment search returns `not_configured`; the rest of the product is unaffected |
| `COGNEE_URL` | no | The shared layer degrades to baseline extraction (D31) |
| `ENRICHMENT_OPERATOR_USER_ID` | for the worker | Must be a real `platform_operators` row. Without it, `claim` returns empty and a spend that cannot be recorded does not happen — the cap is only real if every charge lands |

---

## 6. Regions

Postgres, object storage and the container all in the EU (D15). This is a load-
bearing sales point for corporate clients, not a preference — `docs/` and the
privacy page both state it, and moving any one of them out of region makes those
statements untrue.

---

## 7. The external track (§5 of CLAUDE.md)

None of it blocks launch, and all of it starts on day one:

| Item | Owner | Blocks |
|---|---|---|
| Google CASA Tier 2 + OAuth verification | — | Gmail OAuth (Phase 11) only. The forwarding alias is the permanent fallback |
| Meta business verification, Tech Provider, App Review | — | WhatsApp (Phase 12) only |
| Anthropic DPA / zero-retention | — | Nothing technical. Commercial process |
| German legal review | **counsel** | §8.3 wording, AGB, withdrawal rights per service type. Cannot be closed by engineering |
| Stripe activation | — | Paywall (Phase 8). Build in test mode from minute one |
