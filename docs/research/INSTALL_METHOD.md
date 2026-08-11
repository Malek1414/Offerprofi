# Install method research — publikhq.com

**Researched:** 2026-08-11 · **Question:** what distribution method does Mann Bellani / publikhq.com
use to let non-technical followers install open-source apps, and should we copy it?

**Headline: it is not a PWA.** The handoff document's assumption ("manifest.webmanifest, service
worker, platform-specific install prompts, iOS 'Zum Home-Bildschirm'") is not what this source does.
Do not build to that assumption on the strength of the handoff. See §4 for what to do instead.

## 1. What the source actually is — confirmed

publikhq.com is a **curated directory of open-source replacements for paid apps**, run by Mann
Bellani (GitHub `Blueturboguy07`). Tagline, verbatim: *"F\*ck software subscriptions. Open source has
been around for decades. Our goal is to make it mainstream."* 14 listed apps (cue, WhimprFlow,
NitroAI, Simplicity, FreeHarmony, Lunara, NoScroll, Astro, Nut AI, OpenASCII, Nutcracker, PlantGPT,
Hickeyfield, Dripwriter Origin), tagged by platform: *Mac & Windows*, *iPhone & Android*, or
*Web app*.

Pages read: `/`, `/about`, `/apps`, `/cue`, `/lunara`, `/noscroll`, `/freeharmony`,
`/noscroll/install`, `/noscroll/install/mac-iphone`, `/freeharmony/install/mac`, and the
`Blueturboguy07/freeharmony` repo root.

## 2. The method — confirmed

**A hand-written, copy-paste terminal install guide, one page per (your computer × your device)
pair, that walks a non-technical person through building the app from source.** No installer, no
store, no PWA.

Verbatim from `/lunara`:

> "Lunara is not on the App Store or Google Play, and there is no installer to double-click. You
> build it from this repository and run it on your own phone."

Verbatim from `/noscroll/install`:

> "Pick the setup you have and follow the steps. Every command is written out — you do not need to
> know what any of it means."

The repeatable ingredients, all confirmed:

- **Product page per app** → one CTA, *"Read the install guide→"*, plus *"Open in GitHub↗"*.
- **Install hub** (`/noscroll/install`) branching to device pairs: `mac-iphone`, `mac-android`,
  `windows-android`.
- **A "Combinations that will not work" section** — `windows-iphone` is called out as impossible
  rather than left for the user to discover after 30 minutes.
- **Guide pages** with numbered steps (18 for NoScroll Mac→iPhone: 2 one-time installs, 11 core,
  5 verification), every command spelled out, and a **time estimate** — *"About 35 minutes"*.
- **A pinned commit SHA** so the guide can't drift from the code:
  `git checkout 420374370549f7e90603f030820128bfc9f62fc0` (FreeHarmony).
- Tooling installed along the way: Xcode, Git, Node LTS, pnpm. iPhone installs are an **unsigned
  build side-loaded via Xcode with a personal Apple ID**.
- Even the *Web app* listings mean "run it locally": FreeHarmony's Mac guide ends at
  `pnpm dev` → `localhost:3000`, described as *"FreeHarmony running in your browser, on your own
  computer."* A hosted copy exists at `freeharmony.vercel.app` but is offered as a link, not an
  install.

**Negative findings, checked deliberately:** across all ten pages and the repo root there is **no**
mention of PWA, `manifest.webmanifest`, `manifest.json`, service worker, `beforeinstallprompt`,
"Add to Home Screen", the Safari share sheet, TestFlight, APK download, or app-store links. The
FreeHarmony repo (a Next.js pnpm monorepo, `apps/web`) ships no manifest and no `next-pwa` config.

**Unconfirmed:** `/about` says *"sign in once, and download it"* and a search snippet mentions *"the
right download for your computer"* — I found no page that actually serves a binary, so either it is
aspirational copy or it sits behind the sign-in. `/noscroll/install` also references **"Iris, a
desktop app that automates the process"**; I could not locate it and cannot say what it does.

## 3. Why this method exists — inference, not from the source

Publik distributes **software the user owns and runs**. Build-from-source is the point: no signing
certificate, no $99 Apple developer account, no store review, no hosting bill, and the user's data
never leaves their machine. The 35 minutes is the deliberate price of that.

## 4. Recommendation for our app

**Do not copy Publik's method.** It solves a different problem. Ours is a hosted, multi-tenant,
Stripe-paywalled SaaS (D15, D26) whose buyer is Lisa — a solo wedding planner on a phone — and
whose *customers* reach us through a tokenised chat or quote link. Two hard mismatches:

1. **Customer surfaces must stay zero-install.** A bride opening `chat.<domain>/a/{slug}` from an
   Instagram bio must never be asked to install anything. Publik's model has no equivalent to our
   tokenised-link audience.
2. **`git clone` + Xcode is disqualifying for our buyer.** CLAUDE.md §7: *"Setup steps must be
   doable unaided in minutes."* 35 minutes of terminal work fails that outright, and there is
   nothing to build from source anyway — the product is a server.

**So: the handoff was wrong about the source but right about the destination.** A PWA is still the
correct shape for us — just arrive at it on its own merits, not as "the Publik method". Concretely:

- **PWA for the owner surface only** — the dashboard/inbox Lisa checks between viewings.
  `manifest.webmanifest` (standalone, DE name, maskable icons), a minimal service worker for shell
  caching and offline fallback. Do **not** cache quote or pricing data offline; a stale price on a
  *freibleibend* quote is a §2 problem, not a UX one.
- **Customer surfaces: no install prompt, no service worker.** Keep them a plain fast page. This
  also protects the TDDDG §25 "essential session cookie only" posture in §6.
- **iOS:** there is no `beforeinstallprompt`. Detect iOS Safari and render inline German
  instructions — *Teilen → "Zum Home-Bildschirm"* — with the share glyph drawn, not described.
  Show it only on the owner surface, only once, dismissible.
- **Android/desktop:** capture `beforeinstallprompt`, defer it, surface your own "App installieren"
  button in owner settings rather than letting Chrome's mini-infobar fire unprompted.

**The one thing genuinely worth stealing from Publik** is the *craft of the instructions*, which
transfers even though the mechanism does not: branch by exact device, write every step out, state
how long it takes, and name up front the combination that will not work. iOS add-to-home-screen is
exactly that kind of trap — Safari-only, silently unavailable in Chrome or in-app browsers such as
Instagram's, which is precisely where Lisa's traffic comes from. Say so on the page.
