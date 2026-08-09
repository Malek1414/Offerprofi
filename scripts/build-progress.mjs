#!/usr/bin/env node
/**
 * Regenerates docs/progress.html — the one-glance view of how much of the product exists.
 *
 * The number has to be derived, not typed. A hand-maintained percentage drifts within a
 * session and then quietly lies for weeks, which is worse than having no number at all.
 * So both inputs are the documents that are already the source of truth:
 *
 *   FEATURE_INVENTORY.md  the denominator — every addressable feature, with its phase
 *   BUILD_STATUS.md       the numerator — the honest per-feature account of what exists
 *
 * A feature absent from BUILD_STATUS.md counts as not started. That is the conservative
 * reading and the right one: this file exists to show what is *done*, and anything nobody
 * has written down as built is, for this purpose, not built.
 *
 * Partial counts as half. It is a blunt weight and it is stated on the page, because a
 * progress bar that hides its own arithmetic invites exactly the over-reading it should
 * prevent.
 *
 * Run: npm run progress
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(resolve(root, p), 'utf8')

/** Phase headings in the inventory, e.g. "## 4. Phase 1 — Envelope + hosted chat". */
const PHASE_HEADING = /^##\s+\d+\.\s+(Cross-cutting features \(X\)|Phases?\s+([\d–\-‑]+)\s*—\s*(.+?))\s*$/
/** A feature row: "| F2.13 | **Guardrail configuration form** … | … |". */
const FEATURE_ROW = /^\|\s*(\*\*)?\s*([FX]\d+(?:\.\d+)?)\s*(\*\*)?\s*\|\s*(.+?)\s*\|/
/** A status row in BUILD_STATUS: "| F1.5 sessions | **Partial** | … |". */
const STATUS_ROW = /^\|\s*(\*\*)?\s*([FX]\d+(?:\.\d+)?)\b[^|]*\|\s*\*{0,2}(Done|Partial|Not started|Todo)\*{0,2}\s*\|\s*(.*?)\s*\|?\s*$/i

function parseInventory(md) {
  const features = []
  let phase = null

  for (const line of md.split('\n')) {
    const heading = line.match(PHASE_HEADING)
    if (heading) {
      phase = heading[1].startsWith('Cross-cutting')
        ? { key: 'X', label: 'adapters, guardrails, audit, i18n, invariants', order: -1 }
        : { key: heading[2], label: heading[3], order: Number(String(heading[2]).split(/[–\-‑]/)[0]) }
      continue
    }

    const row = line.match(FEATURE_ROW)
    if (!row || !phase) continue

    // Skip the header separator and any table whose first cell only looks like an id.
    const title = row[4].replace(/\*\*/g, '').replace(/`/g, '').trim()
    if (!title || title === '---') continue

    features.push({ id: row[2], title, phase })
  }

  return features
}

function parseStatuses(md) {
  const statuses = new Map()
  for (const line of md.split('\n')) {
    const row = line.match(STATUS_ROW)
    if (!row) continue
    const state = row[3].toLowerCase()
    statuses.set(row[2], {
      state: state === 'done' ? 'done' : state === 'partial' ? 'partial' : 'todo',
      note: row[4].replace(/\*\*/g, '').replace(/`/g, '').trim(),
    })
  }
  return statuses
}

const WEIGHT = { done: 1, partial: 0.5, todo: 0 }

function main() {
  const features = parseInventory(read('docs/FEATURE_INVENTORY.md'))
  const statuses = parseStatuses(read('docs/BUILD_STATUS.md'))

  if (features.length === 0) throw new Error('no features parsed from FEATURE_INVENTORY.md')

  // Statuses naming a feature the inventory does not have mean the two documents have
  // drifted. Surfaced rather than silently dropped — a stale id here is how the number
  // starts lying.
  const orphans = [...statuses.keys()].filter((id) => !features.some((f) => f.id === id))

  for (const f of features) {
    const found = statuses.get(f.id)
    f.state = found?.state ?? 'todo'
    f.note = found?.note ?? ''
  }

  const phases = new Map()
  for (const f of features) {
    const key = f.phase.key
    if (!phases.has(key)) phases.set(key, { ...f.phase, features: [] })
    phases.get(key).features.push(f)
  }

  const ordered = [...phases.values()].sort((a, b) => a.order - b.order)
  for (const p of ordered) {
    p.credit = p.features.reduce((sum, f) => sum + WEIGHT[f.state], 0)
    p.pct = Math.round((p.credit / p.features.length) * 100)
    p.done = p.features.filter((f) => f.state === 'done').length
    p.partial = p.features.filter((f) => f.state === 'partial').length
  }

  const total = features.length
  const credit = features.reduce((sum, f) => sum + WEIGHT[f.state], 0)
  const pct = Math.round((credit / total) * 100)
  const counts = {
    done: features.filter((f) => f.state === 'done').length,
    partial: features.filter((f) => f.state === 'partial').length,
    todo: features.filter((f) => f.state === 'todo').length,
  }

  writeFileSync(resolve(root, 'docs/progress.html'), render({ pct, credit, total, counts, ordered, orphans }))

  console.log(`docs/progress.html — ${pct}% (${counts.done} done, ${counts.partial} partial, ${counts.todo} to go, of ${total})`)
  if (orphans.length) console.warn(`  warning: BUILD_STATUS ids not in the inventory: ${orphans.join(', ')}`)
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function render({ pct, credit, total, counts, ordered, orphans }) {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')

  const phaseRows = ordered
    .map(
      (p) => `
    <section class="phase">
      <div class="phase-head">
        <h2>${esc(p.key === 'X' ? 'Cross-cutting' : `Phase ${p.key}`)} <span class="phase-label">${esc(p.label)}</span></h2>
        <span class="phase-pct${p.pct === 100 ? ' complete' : ''}">${p.pct}%</span>
      </div>
      <div class="bar" role="img" aria-label="${p.pct} percent">
        <div class="fill" style="width:${p.pct}%"></div>
      </div>
      <p class="tally">${p.done} done${p.partial ? ` · ${p.partial} partial` : ''} · ${p.features.length} total</p>
      <details>
        <summary>features</summary>
        <ul class="features">
          ${p.features
            .map(
              (f) => `<li class="f ${f.state}"><span class="dot"></span><b>${esc(f.id)}</b> ${esc(f.title)}${
                f.note ? `<em>${esc(f.note)}</em>` : ''
              }</li>`,
            )
            .join('\n          ')}
        </ul>
      </details>
    </section>`,
    )
    .join('\n')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Build progress</title>
<style>
  :root {
    --bg: #fbfaf8; --card: #fff; --ink: #1a1a1a; --muted: #6b6b6b; --line: #e5e2dc;
    --done: #2f7d55; --partial: #c08a2e; --todo: #d4d0c8; --accent: #2f7d55;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #16150f; --card: #201f19; --ink: #f2efe8; --muted: #a09c92; --line: #34322a;
      --done: #57b37f; --partial: #d8a94a; --todo: #3c3a32; --accent: #57b37f;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2.5rem 1.25rem 4rem; background: var(--bg); color: var(--ink);
    font: 16px/1.55 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
  }
  .wrap { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 1.35rem; margin: 0 0 .25rem; letter-spacing: -.01em; }
  .sub { color: var(--muted); font-size: .85rem; margin: 0 0 2rem; }
  .total { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 1.5rem; margin-bottom: 2.5rem; }
  .big { font-size: 3.5rem; font-weight: 650; line-height: 1; letter-spacing: -.03em; }
  .big span { font-size: 1.5rem; color: var(--muted); font-weight: 400; }
  .of { color: var(--muted); font-size: .9rem; margin: .5rem 0 1.1rem; }
  .bar { height: 10px; background: var(--todo); border-radius: 99px; overflow: hidden; }
  .total .bar { height: 14px; }
  .fill { height: 100%; background: var(--accent); border-radius: 99px; }
  .legend { display: flex; gap: 1.1rem; flex-wrap: wrap; margin-top: 1rem; font-size: .82rem; color: var(--muted); }
  .legend b { color: var(--ink); font-weight: 600; }
  .phase { margin-bottom: 1.6rem; }
  .phase-head { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; }
  h2 { font-size: .95rem; margin: 0 0 .45rem; font-weight: 600; }
  .phase-label { color: var(--muted); font-weight: 400; }
  .phase-pct { font-variant-numeric: tabular-nums; font-size: .85rem; color: var(--muted); }
  .phase-pct.complete { color: var(--done); font-weight: 600; }
  .tally { font-size: .78rem; color: var(--muted); margin: .4rem 0 0; }
  details { margin-top: .35rem; }
  summary { font-size: .78rem; color: var(--muted); cursor: pointer; }
  .features { list-style: none; margin: .6rem 0 0; padding: 0; font-size: .82rem; }
  .f { display: grid; grid-template-columns: 10px auto 1fr; gap: .5rem; align-items: baseline; padding: .18rem 0; }
  .f em { grid-column: 3; color: var(--muted); font-style: normal; display: block; font-size: .76rem; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--todo); transform: translateY(-1px); }
  .done .dot { background: var(--done); }
  .partial .dot { background: var(--partial); }
  .todo { color: var(--muted); }
  .note { margin-top: 2.5rem; padding-top: 1.2rem; border-top: 1px solid var(--line); font-size: .78rem; color: var(--muted); }
  .note code { background: var(--card); padding: .1rem .3rem; border-radius: 4px; }
  .warn { color: var(--partial); }
</style>
</head>
<body>
<div class="wrap">
  <h1>Build progress</h1>
  <p class="sub">Quote automation for small event agencies · generated ${esc(stamp)}</p>

  <div class="total">
    <div class="big">${pct}<span>%</span></div>
    <p class="of">${credit % 1 === 0 ? credit : credit.toFixed(1)} of ${total} features</p>
    <div class="bar" role="img" aria-label="${pct} percent of the build complete">
      <div class="fill" style="width:${pct}%"></div>
    </div>
    <div class="legend">
      <span><b>${counts.done}</b> done</span>
      <span><b>${counts.partial}</b> partial</span>
      <span><b>${counts.todo}</b> to go</span>
    </div>
  </div>

${phaseRows}

  <p class="note">
    Counted from <code>FEATURE_INVENTORY.md</code> (the denominator) against
    <code>BUILD_STATUS.md</code> (what exists). Partial counts as half; a feature nobody
    has written down as built counts as zero. Regenerate with <code>npm run progress</code>.
    ${orphans.length ? `<br><span class="warn">Drift: ${esc(orphans.join(', '))} in BUILD_STATUS but not in the inventory.</span>` : ''}
  </p>
</div>
</body>
</html>
`
}

main()
