/**
 * Which install path — if any — this browser actually has.
 *
 * "Show an install button" is a one-platform answer to a three-platform problem, and
 * the two platforms it misses are the two that matter most for this product:
 *
 *   **iOS has no `beforeinstallprompt`.** Apple never implemented it. On iOS the only
 *   way onto the home screen is the user doing it by hand through the share sheet, so
 *   a button is not merely unstyled there, it is impossible. The product has to say
 *   the words "Teilen → Zum Home-Bildschirm" instead.
 *
 *   **In-app browsers cannot install at all, and say nothing about it.** Instagram,
 *   Facebook and LinkedIn open links in an embedded WebView. On iOS that WebView has
 *   no share-sheet "Zum Home-Bildschirm" entry; on Android it never fires
 *   `beforeinstallprompt`. Nothing errors — the option is simply absent. This is not
 *   an edge case for us: Lisa's traffic *originates* in an Instagram bio link
 *   (CLAUDE.md §11, §4), so the in-app browser is a common first touch, and an owner
 *   who taps a dead install button concludes the product is broken.
 *   docs/research/INSTALL_METHOD.md calls this out as the trap worth naming up front,
 *   the way publikhq.com names the device combination that will not work.
 *
 * The detection is a pure function over a snapshot of the browser environment so it
 * can be reasoned about and exercised without a browser. Everything that touches
 * `window` is confined to `readBrowserEnv`.
 */

/** What the browser will let the owner do, resolved to exactly one outcome. */
export type InstallPath =
  /** Already launched from the home screen. There is nothing left to offer. */
  | { kind: 'standalone' }
  /** Chromium fired `beforeinstallprompt`; we hold it and can show a real button. */
  | { kind: 'prompt' }
  /** iOS Safari: manual, via the share sheet. The one place the instructions belong. */
  | { kind: 'ios-safari' }
  /** iOS, but not Safari. Add-to-home-screen is Safari's, so send her there. */
  | { kind: 'ios-other' }
  /** An embedded WebView. No install of any kind; the fix is leaving the app. */
  | { kind: 'in-app-browser'; app: string; ios: boolean }
  /** Desktop Safari, Firefox, or Chromium before it has decided. Say nothing. */
  | { kind: 'unavailable' }

export interface BrowserEnv {
  userAgent: string
  /** iPadOS 13+ reports a Macintosh UA; touch points are what give it away. */
  maxTouchPoints: number
  /** True when the document is already running as an installed app. */
  standalone: boolean
}

/**
 * The embedded WebViews worth naming, most specific first.
 *
 * Named rather than lumped together as "in-app browser" because the escape hatch is
 * in a different place in each one, and "tippen Sie auf ⋯" is only useful advice if
 * the owner knows which ⋯ we mean. `FBAN`/`FBAV`/`FB_IAB` are Meta's own tokens and
 * appear for both the Facebook app and, on some versions, Instagram — Instagram is
 * checked first so the more specific name wins.
 */
const IN_APP_BROWSERS: ReadonlyArray<{ token: RegExp; app: string }> = [
  { token: /Instagram/i, app: 'Instagram' },
  { token: /FBAN|FBAV|FB_IAB|FBIOS/, app: 'Facebook' },
  { token: /LinkedInApp/i, app: 'LinkedIn' },
  { token: /TikTok|musical_ly|BytedanceWebview/i, app: 'TikTok' },
  { token: /Snapchat/i, app: 'Snapchat' },
  { token: /Pinterest/i, app: 'Pinterest' },
  { token: /WhatsApp/i, app: 'WhatsApp' },
  { token: /\bLine\//i, app: 'LINE' },
  { token: /Threads/i, app: 'Threads' },
]

/** iOS browsers that are not Safari. All WebKit underneath; none of them is the one. */
const IOS_NON_SAFARI = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|YaBrowser|Brave/

/**
 * Read the environment once, at mount.
 *
 * Kept separate from `detectInstallPath` so the decision itself never touches a
 * global, and so the caller controls *when* the read happens — which matters, because
 * on the server there is no `window` and rendering anything platform-dependent during
 * SSR is a hydration mismatch waiting to be reported as "the button flickers".
 */
export function readBrowserEnv(): BrowserEnv {
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    // iOS never implemented the display-mode media query for standalone; this
    // non-standard flag on `navigator` is the only signal Safari gives.
    (navigator as Navigator & { standalone?: boolean }).standalone === true

  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone,
  }
}

/** iPhone, iPod, iPad — including an iPad claiming to be a Mac. */
function isIos(env: BrowserEnv): boolean {
  if (/iPhone|iPad|iPod/.test(env.userAgent)) return true
  return /Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1
}

/**
 * Resolve the single thing to offer.
 *
 * Order is load-bearing. The in-app browser check runs **before** the deferred prompt,
 * because an Android in-app WebView is Chromium and could in principle surface a
 * prompt that then fails to install anything useful; and it runs before the iOS
 * branch, because an Instagram WebView on iOS is iOS but has no share-sheet entry to
 * point at. Getting this order wrong produces advice that is confidently wrong, which
 * is worse than no advice.
 */
export function detectInstallPath(env: BrowserEnv, promptAvailable: boolean): InstallPath {
  if (env.standalone) return { kind: 'standalone' }

  const ios = isIos(env)

  const embedded = IN_APP_BROWSERS.find((candidate) => candidate.token.test(env.userAgent))
  if (embedded) return { kind: 'in-app-browser', app: embedded.app, ios }

  if (promptAvailable) return { kind: 'prompt' }

  if (ios) {
    // Safari identifies itself with both tokens; a bare WKWebView has neither, and the
    // alternative iOS browsers add their own on top. Requiring both, and rejecting the
    // known impostors, is the closest thing to a reliable "this is Safari" there is.
    const looksLikeSafari = /Safari/.test(env.userAgent) && /Version\//.test(env.userAgent)
    return looksLikeSafari && !IOS_NON_SAFARI.test(env.userAgent)
      ? { kind: 'ios-safari' }
      : { kind: 'ios-other' }
  }

  return { kind: 'unavailable' }
}
