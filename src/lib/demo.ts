/**
 * Demo tenant.
 *
 * Lets the customer-facing surfaces run before Postgres is provisioned, so the
 * design can be reviewed and the flow walked through on a laptop with no
 * credentials. Every route that uses this checks `hasDatabase()` first and prefers
 * real data whenever it is configured.
 *
 * The agency is Lisa from the brief's persona 1 — solo wedding planner, 15–20
 * weddings a year, acquires on Instagram. Using her rather than "Acme GmbH" keeps
 * the copy honest: if a screen reads badly for Lisa, it reads badly.
 */

import {
  type Catalogue,
  buildCatalogue,
  catalogItemId,
} from '../domain/catalogue'
import { eurosToCents } from '../domain/money'
import type { PricingInput } from '../domain/pricing-input'
import type { QuoteAgency } from '../app/q/[token]/quote-document'

export { hasDatabase } from '../db/client'

export const DEMO_AGENCY: QuoteAgency = {
  name: 'Lisa Meier Hochzeiten',
  legalName: 'Lisa Meier Hochzeiten e.K.',
  address: ['Lindenstraße 14', '50667 Köln'],
  contact: 'hallo@lisameier-hochzeiten.de · +49 221 5544332',
  taxId: 'DE311204588',
  logoUrl: null,
  ownerName: 'Lisa',
}

/** Her Instagram pink. Deliberately a colour that fails contrast, so the
 *  theming guarantee in lib/theme.ts is exercised on every demo page load. */
export const DEMO_BRAND_COLOR = '#E8A0B4'

const ITEM_PLANNING = catalogItemId('itm_full_planning')
const ITEM_DECOR = catalogItemId('itm_decoration')
const ITEM_CATERING = catalogItemId('itm_catering')
const ITEM_DJ = catalogItemId('itm_dj')

export function demoCatalogue(): Catalogue {
  return buildCatalogue({
    items: [
      {
        id: ITEM_PLANNING,
        agencyId: 'demo',
        name: 'Hochzeitsplanung Komplett',
        description: 'Konzept, Dienstleisterauswahl, Zeitplan und Koordination am Hochzeitstag',
        unit: 'Pauschale',
        unitPrice: eurosToCents(2450),
        floorPrice: eurosToCents(2450),
        vatRate: 19,
        quantityDriver: 'flat',
        active: true,
      },
      {
        id: ITEM_DECOR,
        agencyId: 'demo',
        name: 'Florale Dekoration',
        description: 'Trauung, Tischdekoration und Raumkonzept, saisonale Blumen',
        unit: 'Pauschale',
        unitPrice: eurosToCents(1180),
        floorPrice: eurosToCents(950),
        vatRate: 19,
        quantityDriver: 'flat',
        active: true,
      },
      {
        id: ITEM_CATERING,
        agencyId: 'demo',
        name: 'Menü und Service',
        description: 'Drei-Gänge-Menü inkl. Servicepersonal, vegetarische und vegane Option',
        unit: 'Personen',
        unitPrice: eurosToCents(78.5),
        floorPrice: eurosToCents(65),
        vatRate: 7,
        quantityDriver: 'per_guest',
        active: true,
      },
      {
        id: ITEM_DJ,
        agencyId: 'demo',
        name: 'DJ inkl. Technik',
        description: 'Ton- und Lichtanlage, Absprache der Playlist im Vorfeld',
        unit: 'Stunden',
        unitPrice: eurosToCents(145),
        floorPrice: eurosToCents(120),
        vatRate: 19,
        quantityDriver: 'per_hour',
        active: true,
      },
    ],
    priceRules: [
      { catalogItemId: ITEM_CATERING, minQty: 0, maxQty: 49, unitPrice: eurosToCents(78.5) },
      { catalogItemId: ITEM_CATERING, minQty: 50, maxQty: 99, unitPrice: eurosToCents(72) },
      { catalogItemId: ITEM_CATERING, minQty: 100, maxQty: null, unitPrice: eurosToCents(68) },
    ],
    modifiers: [
      {
        id: 'mod_peak' as never,
        agencyId: 'demo',
        kind: 'peak_season',
        condition: {
          kind: 'peak_season',
          ranges: [{ startsOn: '2026-05-01', endsOn: '2026-09-30' }],
        },
        adjustmentType: 'pct',
        value: 15,
        orderIndex: 1,
      },
    ],
  })
}

export function demoPricingInput(): PricingInput {
  return {
    eventType: 'wedding',
    eventDate: '2027-06-12',
    guestCount: 80,
    durationHours: 8,
    distanceKm: 35,
    serviceIds: [ITEM_PLANNING, ITEM_DECOR, ITEM_CATERING, ITEM_DJ],
    packageIds: [],
    availability: 'peak_season',
    reverseCharge: false,
  }
}

export const DEMO_QUOTE_META = {
  quoteNumber: '2026-0042',
  issuedOn: '2026-08-08',
  validUntil: '2026-08-22',
  customerName: 'Sarah Brandt und Jonas Weber',
  eventSummary: 'Hochzeit am 12. Juni 2027, Schloss Bensberg',
}
