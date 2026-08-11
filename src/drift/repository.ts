/**
 * Persisting drift, and the two rules that keep it a nudge rather than a chore.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A WEEKLY JOB THAT REPEATS ITSELF IS A WEEKLY JOB THAT GETS IGNORED.
 *
 * `detectDrift` is pure and knows nothing about what it said last week. Left to
 * itself a Sunday re-crawl would file the same three cards it filed on the Sunday
 * before, and by the end of the month the owner would have twenty-one rows saying
 * one thing — at which point the feature has taught her that drift cards are
 * noise, which is worse than never having shipped it.
 *
 * Two mechanisms, and neither is in the detector:
 *
 *  · the partial unique index in 0025 — one *open* card per (item, field), so a
 *    repeat detection collides instead of stacking. `on conflict do nothing`
 *    rather than `do update`: the card the owner has already seen keeps its
 *    original `detected_at`, so "this has been sitting here for three weeks"
 *    stays a true statement.
 *  · dismissal is durable. A dismissed card does not come back the next week for
 *    the same unchanged difference, because saying "no, my website is out of
 *    date" is an answer, and asking again is not listening.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { hasDatabase, withUser } from '../db/client'
import type { DriftCard } from './detect'

export interface OpenDriftCard extends DriftCard {
  id: string
  itemName: string
  detectedAt: string
}

/**
 * File a detection run's cards.
 *
 * Returns how many were new. The count is what the caller decides whether to
 * notify on — a run that re-detected three cards the owner is already looking at
 * is not worth an email.
 */
export async function recordDrift(
  userId: string,
  agencyId: string,
  cards: readonly DriftCard[],
): Promise<number> {
  if (!hasDatabase() || cards.length === 0) return 0

  return withUser(userId, async (client) => {
    let inserted = 0

    for (const card of cards) {
      const result = await client.query(
        `insert into catalogue_drift
           (agency_id, catalog_item_id, field, current_value, observed_value, source_url, excerpt)
         values ($1, $2, $3, $4, $5, $6, $7)
         -- The index this collides with is partial on status = 'open', so a card the
         -- owner already dismissed does not block a *newly* detected one after she
         -- has moved on — it blocks the same one being filed twice.
         on conflict do nothing
         returning id`,
        [
          agencyId,
          card.catalogItemId,
          card.field,
          card.currentValue,
          card.observedValue,
          card.sourceUrl,
          card.excerpt,
        ],
      )
      inserted += result.rowCount ?? 0
    }

    return inserted
  })
}

/**
 * What the owner is being asked about right now.
 *
 * Joined to `catalog_items` for the name, because a card reading "unitPriceCents
 * changed from 1850 to 2100" identifies the row to a developer and to nobody else.
 * She confirmed a thing called Fingerfood-Menü and that is what she has to see.
 */
export async function openDrift(userId: string, agencyId: string): Promise<OpenDriftCard[]> {
  if (!hasDatabase()) return []

  return withUser(userId, async (client) => {
    const result = await client.query(
      `select d.id, d.catalog_item_id, d.field, d.current_value, d.observed_value,
              d.source_url, d.excerpt, d.detected_at, ci.name as item_name
         from catalogue_drift d
         join catalog_items ci on ci.id = d.catalog_item_id
        where d.agency_id = $1 and d.status = 'open'
        order by d.detected_at desc`,
      [agencyId],
    )

    return result.rows.map((row) => ({
      id: String(row.id),
      catalogItemId: String(row.catalog_item_id),
      itemName: String(row.item_name),
      field: String(row.field) as DriftCard['field'],
      currentValue: String(row.current_value),
      observedValue: String(row.observed_value),
      sourceUrl: String(row.source_url),
      excerpt: String(row.excerpt),
      detectedAt: new Date(row.detected_at).toISOString(),
    }))
  })
}

/**
 * Accept the observed value into the catalogue, or dismiss the card.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ACCEPTING A DRIFT CARD IS A CONFIRMATION, WITH THE SAME STANDING AS ANY OTHER.
 *
 * §7: nothing enters the live catalogue unconfirmed. A drift card is not an
 * exception dressed as a convenience — it is the *shortest possible* confirmation,
 * one named human answering one question about one field, and the write it
 * performs is the same write the candidate queue performs.
 *
 * Dismissal is recorded rather than deleted, and it is the more interesting of the
 * two verdicts: "my website is out of date, the catalogue is right" is a fact
 * about which source to trust for this agency, and it is exactly the kind of
 * signal §4 says the owner's verdict is for.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export type DriftDecision =
  | { outcome: 'decided' }
  | { outcome: 'not_found' }
  /**
   * The website's price is below the floor the owner set for that item.
   *
   * Refused rather than resolved, and this is the one interesting branch in the
   * file. `floor_not_above_list` means accepting the drop requires the floor to
   * move too — and moving an owner's floor as an invisible side effect of her
   * confirming a *price* is D8 weakened by a mechanism nobody chose. The floor is
   * the number the guardrail engine defends on her behalf; it moves when she moves
   * it, in the catalogue editor, having been told what it is for.
   *
   * So the card says what it found and what it conflicts with, and sends her one
   * tap away to the place where both numbers are editable together.
   */
  | { outcome: 'below_floor'; floorCents: number; observedCents: number }

export async function decideDrift(
  userId: string,
  agencyId: string,
  driftId: string,
  verdict: 'accepted' | 'dismissed',
): Promise<DriftDecision> {
  if (!hasDatabase()) return { outcome: 'not_found' }

  return withUser(userId, async (client) => {
    const card = await client.query(
      `select d.catalog_item_id, d.field, d.observed_value, ci.floor_price_cents
         from catalogue_drift d
         join catalog_items ci on ci.id = d.catalog_item_id
        where d.id = $1 and d.agency_id = $2 and d.status = 'open'`,
      [driftId, agencyId],
    )

    const row = card.rows[0]
    if (!row) return { outcome: 'not_found' as const }

    if (verdict === 'accepted') {
      // Only the two columns a card can be about. Written as an explicit branch
      // rather than by interpolating `field` into the SQL — the value arrives from
      // a request body, and "it can only ever be one of two strings" is a property
      // worth enforcing here rather than trusting upstream to have checked.
      const field = String(row.field)

      if (field === 'unitPriceCents') {
        const observedCents = Number(row.observed_value)
        const floorCents = Number(row.floor_price_cents)

        // Checked here rather than left to the constraint. Letting the CHECK fire
        // would abort the transaction and surface as a 500 — technically safe, and
        // it would tell her nothing about which two numbers disagree.
        if (observedCents < floorCents) {
          return { outcome: 'below_floor' as const, floorCents, observedCents }
        }

        await client.query(
          'update catalog_items set unit_price_cents = $3 where id = $1 and agency_id = $2',
          [row.catalog_item_id, agencyId, observedCents],
        )
      } else if (field === 'unit') {
        await client.query('update catalog_items set unit = $3 where id = $1 and agency_id = $2', [
          row.catalog_item_id,
          agencyId,
          String(row.observed_value),
        ])
      } else {
        return { outcome: 'not_found' as const }
      }
    }

    await client.query(
      `update catalogue_drift
          set status = $3::drift_status, decided_at = now(), decided_by = public.current_user_id()
        where id = $1 and agency_id = $2 and status = 'open'`,
      [driftId, agencyId, verdict],
    )

    return { outcome: 'decided' as const }
  })
}
