# Phases, and how to take them back apart

`main` carries all six phases as one linear run of 27 commits, pushed on 11 Aug 2026.
This file is what makes that reversible: which commit belongs to which phase, what
guarantees the phases stay recoverable, and the exact commands to extract or revert one.

Written because a linear `main` is where phase boundaries normally go to die. Six weeks
from now, "which commits were the upload work?" is a question nobody can answer from the
log alone, and by then the branches may have been tidied away.

---

## 1. What guarantees a phase stays recoverable

Three independent mechanisms, listed weakest first. Any one of them is enough.

| | Mechanism | Survives |
|---|---|---|
| Weakest | **Branches** — `phase-a-model-in-the-loop` … `phase-f-execution-and-security` | Anyone can delete or force-move a branch |
| Stronger | **Annotated tags** — `phase-a` … `phase-f`, plus `pre-execution-handoff` and `execution-handoff-complete` | Deletable, but never moved by ordinary work, and they carry their own message |
| Strongest | **GitHub PR refs** — `refs/pull/1..7/head` | **Permanent.** GitHub keeps them even after the branch is deleted, and they cannot be force-moved |

That last row is the real backstop. Even with every branch and tag gone:

```bash
git fetch origin 'refs/pull/*/head:refs/remotes/pr/*'
git checkout pr/3          # Phase C exactly as it was reviewed
```

| PR | Phase | Ref |
|---|---|---|
| #7 (and #1) | A | `refs/pull/7/head` |
| #2 | B | `refs/pull/2/head` |
| #3 | C | `refs/pull/3/head` |
| #4 | D | `refs/pull/4/head` |
| #5 | E | `refs/pull/5/head` |
| #6 | F | `refs/pull/6/head` |

---

## 2. The map — every commit on `main`, by phase

Oldest first. The baseline is `e1a96fc` (tag `pre-execution-handoff`); the tip is `dab556e`
(tag `execution-handoff-complete`).

### Phase A — the model boundary (9 commits)

```
e2ff1bd  Design the extraction and learning loop, and table the marketplace
ec90a76  Consolidate the session into one executable handoff
ed2d8f4  Turn the handoff's blockers into work items with defaults
f721167  Take her yes as a send, and retract the A1 finding
759a2dd  Detect prompt injection in code, not by asking the model
5749447  Give the model boundary a cap it can enforce
581b1fd  Render the quote as a file
89fa501  Write down the assistant's half of the conversation
a6434de  Record that phase A is complete
```

### Phase B — files in (4 commits)

```
28d2314  Give Phase B somewhere to put a file            B0  object storage
b1041b0  Make room for a business that is not a customer  B3  prospects schema
333b8de  Make a dropped connection cost one chunk         B1  resumable uploads
ac54251  Read the file formats a caterer actually has     B2  parsing
```

### Phase C — the learning loop (6 commits, plus part of a seventh)

```
928df32  Give enrichment a queue, a budget and a memory   C1
e4a0d0d  Let the shared layer hold how to read            shared layer
5e9b25a  Store the verdict, because the verdict is it     C3  schema
ae2bc7d  Spend the owner's attention only where unsure    C3  UI
ddeab40  Prove the model never prices, by trying to make it  C2  tests
b0aac57  Ask the owner one more question, a week later    C4  drift
```

⚠️ **plus part of `fcf8973`** — see §3.

### Phase D — mobile and desktop (3 commits, one of them shared)

```
5b74cab  Make the owner's half installable                D3  PWA
0450e7d  Upload from a phone that keeps losing signal     D2  upload UI
fcf8973  Make the app work on the phone it is sold to     D1  responsive  ⚠️ shared with C5
```

### Phase E — ops (1 commit)

```
f15841f  Give the container a way to say it is broken
```

### Phase F — the run-it button and the security pass (4 commits)

```
76659f6  Join the enquiry to the document                 execution button
3b24873  Stop showing the customer the floor              H1/H2/H3 fixes
53491f1  Say what the 33% counts, and what it leaves out  docs
dab556e  Let next dev rewrite its own type reference      generated file
```

---

## 3. The one commit that straddles two phases

**`fcf8973` contains both Phase D1 and Phase C5.** It carries the responsive-shell work
*and* `src/metrics/f1.ts`, `tests/metrics/f1.test.ts` and `db/migrations/0025_drift_and_metrics.sql`.

That matters in two directions:

- **Extracting Phase D** from `main` pulls the C5 metrics along with it.
- **Reverting Phase D** from `main` would take out migration `0025` — which also creates
  `catalogue_drift`, the table Phase C4's drift cards read. Phase C would break.

The rebuilt `phase-c-learning-loop` and `phase-d-apps` branches already have this split
correctly: the migration and the metrics sit in C, where their readers are. `main` does not,
because `main` is the original commit order.

**So: never revert `fcf8973` wholesale.** Revert it with the C5 paths excluded:

```bash
git revert --no-commit fcf8973
git checkout HEAD -- db/migrations/0025_drift_and_metrics.sql src/metrics tests/metrics
git commit -m "Revert the D1 responsive pass, keeping C5's metrics and migration 0025"
```

---

## 4. Extracting a phase from `main`

Verified to reproduce each branch **byte for byte**. Phase B onto the Phase A tip:

```bash
git checkout --detach a6434de
git cherry-pick 28d2314 b1041b0 333b8de ac54251
git diff --quiet HEAD phase-b-ingestion && echo "identical"
```

Phase D onto the Phase C tip:

```bash
git checkout --detach phase-c-learning-loop
git cherry-pick 5b74cab 0450e7d fcf8973
git diff --quiet HEAD phase-d-apps && echo "identical"
```

Both were run and both report identical. Use `git worktree add` rather than switching
branches in place if you want to keep your working tree where it is.

---

## 5. Reverting a phase from `main`

Checked: **D3 and D2 revert cleanly**, and D1 reverts cleanly with the §3 caveat.

```bash
git revert --no-commit 0450e7d 5b74cab     # D2 + D3
```

Before reverting anything, note what depends on it:

- **D2's upload UI is the only front end for B1's upload pipeline.** Removing it leaves the
  chunked-upload API with no caller.
- **`0025` is load-bearing for C4** — see §3.
- **Phase F's `0026`** narrows the `quote_versions` immutability trigger that `0003`
  installed. Reverting F restores the original trigger, which means quote-link revocation
  becomes impossible again (security finding H2).

---

## 6. Re-landing a phase later

The branches are already rebased into clean per-phase order, so re-landing is a merge, not
an archaeology exercise:

```bash
git checkout main
git merge --no-ff phase-d-apps
```

If the branches are gone, `refs/pull/*/head` (§1) has the same content permanently.
