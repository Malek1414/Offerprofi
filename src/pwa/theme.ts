/**
 * The two chassis colours the operating system is allowed to see.
 *
 * Copied out of src/app/globals.css rather than invented, because these paint surfaces
 * the browser draws *outside* the document — the Android status bar, the iOS splash,
 * the desktop title bar — and a value that merely looks close produces a visible seam
 * along the top of the app that no amount of CSS can reach.
 *
 * They are the achromatic chassis, never the agency's `--brand`. globals.css states
 * the rule: this system hosts someone else's brand, so our own frame stays neutral.
 * The agency's colour appears inside the page, where the agency's document is. A
 * tenant hue leaking into the OS chrome would also be per-tenant, and the manifest is
 * one file for all of them.
 *
 * If globals.css changes these tokens, change them here. There is no way to read a
 * CSS custom property from a manifest or from Next's viewport export, so the
 * duplication is structural, not laziness.
 */

/** `--paper` in globals.css. The ground the inbox is painted on. */
export const CHASSIS_LIGHT = '#fcfcfd'

/** `--paper` inside the dark-scheme block in globals.css. */
export const CHASSIS_DARK = '#14161a'

/**
 * `--ink`. The icon ground, and nothing else — deliberately not used as a theme
 * colour, because a dark status bar above a near-white page reads as a bug on Android.
 */
export const CHASSIS_INK = '#14161c'
