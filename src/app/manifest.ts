import type { MetadataRoute } from 'next'

import { appManifest } from '../pwa/manifest'

/**
 * Next's `app/manifest.ts` convention, served at `/manifest.webmanifest`.
 *
 * Deliberately three lines. The route file's only job is to exist at the path Next
 * looks for; the manifest itself lives in src/pwa/ with the rest of the install path,
 * so the reasoning behind `scope`, the icon purposes and the branding boundary sits
 * next to the code that shares those constants rather than in the routing tree.
 */
export default function manifest(): MetadataRoute.Manifest {
  return appManifest()
}
