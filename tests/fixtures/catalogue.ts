/**
 * Shared fixtures. A small, realistic wedding-planner catalogue.
 *
 * Numbers are deliberately plausible for the DACH market rather than round, because
 * round numbers hide rounding bugs.
 */

import {
  type CatalogItem,
  type Catalogue,
  type Modifier,
  type Package,
  type PriceRule,
  buildCatalogue,
  catalogItemId,
  packageId,
} from '../../src/domain/catalogue'
import { eurosToCents } from '../../src/domain/money'
import type { PricingInput } from '../../src/domain/pricing-input'

export const ITEM_PLANNING = catalogItemId('itm_full_planning')
export const ITEM_DECOR = catalogItemId('itm_decoration')
export const ITEM_CATERING = catalogItemId('itm_catering_per_guest')
export const ITEM_DJ = catalogItemId('itm_dj_per_hour')
export const ITEM_TRAVEL = catalogItemId('itm_travel_per_km')
export const PKG_CLASSIC = packageId('pkg_classic_wedding')

export function items(): CatalogItem[] {
  return [
    {
      id: ITEM_PLANNING,
      agencyId: 'a1',
      name: 'Hochzeitsplanung Komplett',
      description: 'Vollumfängliche Planung und Koordination am Hochzeitstag',
      unit: 'Pauschale',
      unitPrice: eurosToCents(2450),
      floorPrice: eurosToCents(2450),
      vatRate: 19,
      quantityDriver: 'flat',
      active: true,
    },
    {
      id: ITEM_DECOR,
      agencyId: 'a1',
      name: 'Dekoration',
      description: 'Florale Dekoration, Tischgestaltung, Lichtkonzept',
      unit: 'Pauschale',
      unitPrice: eurosToCents(1180),
      floorPrice: eurosToCents(950),
      vatRate: 19,
      quantityDriver: 'flat',
      active: true,
    },
    {
      id: ITEM_CATERING,
      agencyId: 'a1',
      name: 'Catering',
      description: 'Menü inkl. Service',
      unit: 'Person',
      unitPrice: eurosToCents(78.5),
      floorPrice: eurosToCents(65),
      vatRate: 7,
      quantityDriver: 'per_guest',
      active: true,
    },
    {
      id: ITEM_DJ,
      agencyId: 'a1',
      name: 'DJ',
      description: 'DJ inkl. Anlage',
      unit: 'Stunde',
      unitPrice: eurosToCents(145),
      floorPrice: eurosToCents(120),
      vatRate: 19,
      quantityDriver: 'per_hour',
      active: true,
    },
    {
      id: ITEM_TRAVEL,
      agencyId: 'a1',
      name: 'Anfahrt',
      description: 'Anfahrtspauschale pro Kilometer',
      unit: 'km',
      unitPrice: eurosToCents(0.85),
      floorPrice: eurosToCents(0.85),
      vatRate: 19,
      quantityDriver: 'per_km',
      active: true,
    },
  ]
}

export function priceRules(): PriceRule[] {
  return [
    // Staffelpreise on catering: it gets cheaper per head at volume.
    { catalogItemId: ITEM_CATERING, minQty: 0, maxQty: 49, unitPrice: eurosToCents(78.5) },
    { catalogItemId: ITEM_CATERING, minQty: 50, maxQty: 99, unitPrice: eurosToCents(72.0) },
    { catalogItemId: ITEM_CATERING, minQty: 100, maxQty: null, unitPrice: eurosToCents(68.0) },
  ]
}

export function packages(): Package[] {
  return [
    {
      id: PKG_CLASSIC,
      agencyId: 'a1',
      name: 'Klassik-Paket',
      description: 'Planung und Dekoration im Paket',
      bundlePrice: null,
      items: [
        { catalogItemId: ITEM_PLANNING, quantity: 1 },
        { catalogItemId: ITEM_DECOR, quantity: 1 },
      ],
    },
  ]
}

export function modifiers(): Modifier[] {
  return [
    {
      id: 'mod_peak' as Modifier['id'],
      agencyId: 'a1',
      kind: 'peak_season',
      condition: { kind: 'peak_season', ranges: [{ startsOn: '2026-05-01', endsOn: '2026-09-30' }] },
      adjustmentType: 'pct',
      value: 15,
      orderIndex: 1,
    },
    {
      id: 'mod_rush' as Modifier['id'],
      agencyId: 'a1',
      kind: 'rush',
      condition: { kind: 'rush', leadTimeMinDays: 14 },
      adjustmentType: 'fixed',
      value: eurosToCents(250),
      orderIndex: 2,
    },
  ]
}

export function fullCatalogue(): Catalogue {
  return buildCatalogue({
    items: items(),
    priceRules: priceRules(),
    packages: packages(),
    modifiers: modifiers(),
  })
}

/** A catalogue with no modifiers, for tests that want the arithmetic uncluttered. */
export function minimalCatalogue(): Catalogue {
  return buildCatalogue({ items: items(), priceRules: priceRules() })
}

export function minimalPricingInput(overrides: Partial<PricingInput> = {}): PricingInput {
  return {
    eventType: 'wedding',
    eventDate: '2027-03-13', // a Saturday outside peak season
    guestCount: 80,
    durationHours: 8,
    distanceKm: 40,
    serviceIds: [ITEM_DECOR],
    packageIds: [],
    availability: 'available',
    reverseCharge: false,
    ...overrides,
  }
}
