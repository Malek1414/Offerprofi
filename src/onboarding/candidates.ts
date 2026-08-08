/**
 * Catalogue candidates and confirmation (F2.6, F2.8).
 *
 * Acceptance: "Nothing enters the live catalogue unconfirmed. Test: extraction alone
 * never creates a live `catalog_item`."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GUARANTEE IS STRUCTURAL, IN THREE PLACES.
 *
 * Extraction reads an agency's past quotes and proposes prices. If a proposal could
 * slip into the live catalogue unreviewed, the engine would then quote a stranger a
 * number that no human at the agency ever agreed to — and it would be defensible
 * neither commercially nor under D6.
 *
 * So a candidate cannot become a catalogue item by any route that does not pass
 * through a named human:
 *
 *   1. **Type** — `CatalogueCandidate` and `CatalogItem` are unrelated types. There
 *      is no function here from the first to the second. The only way across is
 *      `confirmCandidate`, which requires a user id it cannot invent.
 *   2. **Database** — `catalog_items.active_items_must_be_confirmed` rejects an
 *      active row with a null `confirmed_at` (migration 0001).
 *   3. **Test** — `tests/onboarding/candidates.test.ts` asserts the absence of a
 *      bypass, so adding one fails CI rather than review.
 *
 * Three independent layers because this is exactly the kind of guarantee that gets
 * "temporarily" bypassed during a demo and never restored.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { CatalogItem, QuantityDriver, VatRate } from '../domain/catalogue'
import { catalogItemId } from '../domain/catalogue'
import type { Cents } from '../domain/money'

/**
 * Where a proposed value came from, precisely enough for the owner to check it.
 *
 * F2.8 requires the source shown *inline* — asset, page and text span. An owner
 * confirming twelve prices will not cross-reference a PDF by hand; if she cannot see
 * the sentence the number came from, she will confirm them all blindly and the
 * review becomes theatre.
 */
export interface SourceRef {
  assetId: string
  /** 1-indexed, for documents that have pages. */
  page?: number
  /** The verbatim text the value was read from. */
  excerpt: string
}

/**
 * A proposal. Never priced against, never shown to a customer, never active.
 *
 * Deliberately not `Partial<CatalogItem>`: that would make the two types
 * structurally compatible and a single `as` cast would be enough to cross the line
 * this module exists to hold.
 */
export interface CatalogueCandidate {
  candidateId: string
  agencyId: string
  name: string
  description: string
  unit: string
  unitPriceCents: Cents
  vatRate: VatRate
  quantityDriver: QuantityDriver
  /**
   * F2.6 — how many of the uploaded quotes contained this item.
   *
   * Shown to the owner as the confidence signal it is. An item appearing in all
   * three of her past quotes is her core offering; one appearing once may have been
   * a favour for a friend, and pricing future weddings off it would be wrong.
   */
  frequency: number
  /** Out of how many quotes. `frequency / quoteCount` is the useful ratio. */
  quoteCount: number
  sourceRefs: SourceRef[]
}

/** What the owner may change while confirming. Everything, in practice — extraction
 *  is a first draft and she knows her own prices better than a model does. */
export interface CandidateEdits {
  name?: string
  description?: string
  unit?: string
  unitPriceCents?: Cents
  /** D8 — the hard floor. Defaults to list price, so no-discounting is the
   *  out-of-box behaviour and permitting one is a deliberate act. */
  floorPriceCents?: Cents
  vatRate?: VatRate
  quantityDriver?: QuantityDriver
}

/**
 * The result of a human confirming a candidate.
 *
 * `confirmedBy` and `confirmedAt` are required and non-nullable. A value of this
 * type is proof that a named person decided, on a date — which is what the audit
 * trail has to be able to show.
 */
export interface ConfirmedCatalogItem {
  agencyId: string
  name: string
  description: string
  unit: string
  unitPriceCents: Cents
  floorPriceCents: Cents
  vatRate: VatRate
  quantityDriver: QuantityDriver
  confirmedBy: string
  confirmedAt: string
  sourceAssetIds: string[]
}

/**
 * A rejection. Retained, not deleted (F2.8: "Rejections retained as negative
 * signal").
 *
 * Extraction that keeps proposing something the owner has already thrown out three
 * times is worse than extraction that proposes nothing, and the only way to know is
 * to remember.
 */
export interface RejectedCandidate {
  candidateId: string
  agencyId: string
  rejectedBy: string
  rejectedAt: string
  /** Optional; the owner is not obliged to explain herself. */
  reason?: string
}

/**
 * The only route from a candidate into the live catalogue.
 *
 * Throws on a missing user id rather than defaulting to a system actor. A "system"
 * confirmation is precisely the thing that must not exist — the value of this
 * guarantee is that every live price traces to a person.
 */
export function confirmCandidate(
  candidate: CatalogueCandidate,
  edits: CandidateEdits,
  confirmedBy: string,
  confirmedAt: string,
): ConfirmedCatalogItem {
  if (!confirmedBy) {
    throw new Error('a catalogue item cannot be confirmed without an authenticated user')
  }

  const unitPriceCents = edits.unitPriceCents ?? candidate.unitPriceCents

  // The floor defaults to the list price (D8). An owner who wants room to negotiate
  // lowers it deliberately; she never gets a discount she did not ask for.
  const floorPriceCents = edits.floorPriceCents ?? unitPriceCents

  if (floorPriceCents > unitPriceCents) {
    throw new Error('floor price cannot exceed the list price')
  }
  if (unitPriceCents < 0 || floorPriceCents < 0) {
    throw new Error('prices cannot be negative')
  }

  return {
    agencyId: candidate.agencyId,
    name: edits.name ?? candidate.name,
    description: edits.description ?? candidate.description,
    unit: edits.unit ?? candidate.unit,
    unitPriceCents,
    floorPriceCents,
    vatRate: edits.vatRate ?? candidate.vatRate,
    quantityDriver: edits.quantityDriver ?? candidate.quantityDriver,
    confirmedBy,
    confirmedAt,
    sourceAssetIds: [...new Set(candidate.sourceRefs.map((r) => r.assetId))],
  }
}

export function rejectCandidate(
  candidate: CatalogueCandidate,
  rejectedBy: string,
  rejectedAt: string,
  reason?: string,
): RejectedCandidate {
  if (!rejectedBy) {
    throw new Error('a rejection must name the user who made it')
  }
  return {
    candidateId: candidate.candidateId,
    agencyId: candidate.agencyId,
    rejectedBy,
    rejectedAt,
    ...(reason ? { reason } : {}),
  }
}

/**
 * Turn a confirmed item into a live catalogue item.
 *
 * Takes `ConfirmedCatalogItem`, never `CatalogueCandidate`. That signature is the
 * guarantee: there is no overload, no optional second form, no `force` flag. To
 * reach the engine, a price must have been through `confirmCandidate` first.
 */
export function toLiveCatalogItem(confirmed: ConfirmedCatalogItem, id: string): CatalogItem {
  return {
    id: catalogItemId(id),
    agencyId: confirmed.agencyId,
    name: confirmed.name,
    description: confirmed.description,
    unit: confirmed.unit,
    unitPrice: confirmed.unitPriceCents,
    floorPrice: confirmed.floorPriceCents,
    vatRate: confirmed.vatRate,
    quantityDriver: confirmed.quantityDriver,
    active: true,
  }
}

/**
 * How strongly the evidence supports a candidate, as a 0–1 ratio.
 *
 * Presented to the owner rather than used to auto-confirm anything. Even a candidate
 * appearing in every quote still needs a human — a consistently wrong price is still
 * wrong, and consistency is not correctness.
 */
export function candidateStrength(candidate: CatalogueCandidate): number {
  if (candidate.quoteCount <= 0) return 0
  return Math.min(1, candidate.frequency / candidate.quoteCount)
}
