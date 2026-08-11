import type { MetadataRoute } from 'next'

import { branding } from '../lib/branding'
import { APP_ID, APP_SCOPE, APP_START_URL } from './owner-surface'
import { CHASSIS_LIGHT } from './theme'

/**
 * The web app manifest, built rather than checked in as a static file.
 *
 * The obvious implementation is `public/manifest.webmanifest`, and it is wrong here
 * for one reason: the manifest's `name` is the product name, and CLAUDE.md open
 * question #1 has the product name deliberately behind `src/lib/branding.ts` so that
 * closing it stays "set three environment variables". A static JSON file would be a
 * literal name outside that boundary — the exact thing tests/lib/branding.test.ts
 * exists to prevent — and it would be the *most* visible one, because it is the label
 * under the icon on the owner's home screen and it is baked into the installed app at
 * install time. Renaming it later means every pilot agency reinstalling.
 *
 * So it is generated. Next serves `src/app/manifest.ts` at `/manifest.webmanifest`,
 * which is the same URL a static file would have occupied; nothing downstream can
 * tell the difference. The value is resolved when this route is built, which is the
 * same moment the name is baked into everything else the deployment ships.
 */
export function appManifest(): MetadataRoute.Manifest {
  const { productName } = branding()

  return {
    id: APP_ID,
    name: productName,
    /**
     * Android gives the home-screen label roughly twelve characters before it
     * truncates, so `short_name` is the one field where a long PRODUCT_NAME degrades
     * visibly. It is still the product name and not an abbreviation — inventing a
     * second name here would put a string the owner never chose on her phone.
     */
    short_name: productName,
    description:
      'Anfragen annehmen, Angebote prüfen und freigeben — der Arbeitsplatz für Ihre Agentur.',

    /** DE first (D19). The owner surface is not mirrored to the customer's language. */
    lang: 'de',
    dir: 'ltr',

    start_url: APP_START_URL,
    scope: APP_SCOPE,

    /**
     * `standalone`, not `fullscreen`. This is a tool someone opens between viewings to
     * read an inquiry; hiding the clock and the battery to show her an inbox would be
     * a game's idea of importance.
     */
    display: 'standalone',

    /**
     * The splash and OS chrome colour. Achromatic chassis, never the tenant's brand —
     * see src/pwa/theme.ts. Only the light value can go in a manifest; the dark one is
     * carried by the media-scoped `theme-color` meta tags in src/app/layout.tsx, which
     * a manifest cannot express.
     */
    background_color: CHASSIS_LIGHT,
    theme_color: CHASSIS_LIGHT,

    categories: ['business', 'productivity'],

    /**
     * Two purposes, and they are not interchangeable.
     *
     * `any` keeps our own rounded corner and is what desktop and older launchers draw
     * verbatim. `maskable` bleeds to the edge and lets Android apply whatever mask the
     * launcher uses; shipping only `any` gets the rounded square dropped inside a
     * circle with a white ring around it, which is the single most recognisable sign
     * of a PWA that nobody checked on a real phone.
     *
     * The SVG is listed first and `sizes: 'any'` so a browser that can rasterise it
     * does — it is 2 KB against 4 KB for the 512 PNG and stays sharp on a tablet.
     */
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
