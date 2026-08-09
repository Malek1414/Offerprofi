/**
 * S16/S17 — catalogue (F2.9, F2.11).
 *
 * The manual route through onboarding, and the acceptance criterion for F2.9 is
 * blunt: "Owner can build the whole catalogue by hand if extraction fails." This is
 * that path. It also closes CLAUDE.md open question #5, which asks what happens when
 * the three uploaded quotes are inconsistent or extraction is poor — the answer is
 * that she is never stuck, because this screen never depended on extraction at all.
 *
 * The list is server-rendered so the page is useful before any JavaScript arrives;
 * the editor takes over from there.
 */

import type { Metadata } from 'next'
import Link from 'next/link'

import styles from './catalogue.module.css'
import { CatalogueEditor, type EditorItem } from './catalogue-editor'
import { requireUserId } from '../../../auth/current-user'
import { listAllPriceRules, listCatalogueItems } from '../../../onboarding/repository'
import { priceBandsToForm } from '../../../onboarding/price-band-form'
import { REQUIRED_CONFIRMED_ITEMS } from '../../../onboarding/progress'
import { catalogItemId } from '../../../domain/catalogue'

export const metadata: Metadata = {
  title: 'Leistungen',
}

export default async function CataloguePage() {
  const userId = await requireUserId('/onboarding/catalogue')
  const [items, rules] = await Promise.all([listCatalogueItems(userId), listAllPriceRules(userId)])

  // Grouped once rather than filtered per item, so the page stays linear in the size
  // of the catalogue instead of quadratic.
  const bandsByItem = new Map<string, typeof rules>()
  for (const rule of rules) {
    const existing = bandsByItem.get(rule.catalogItemId)
    if (existing) existing.push(rule)
    else bandsByItem.set(rule.catalogItemId, [rule])
  }

  const initial: EditorItem[] = items
    .filter((item) => item.active)
    .map((item) => {
      const priceBands = priceBandsToForm(
        (bandsByItem.get(item.id) ?? []).map((rule) => ({
          catalogItemId: catalogItemId(rule.catalogItemId),
          minQty: rule.minQty,
          maxQty: rule.maxQty,
          unitPrice: rule.unitPrice,
        })),
      )

      return {
        id: item.id,
        name: item.name,
        description: item.description,
        unit: item.unit,
        unitPrice: item.unitPrice,
        floorPrice: item.floorPrice,
        vatRate: item.vatRate,
        quantityDriver: item.quantityDriver,
        // From the rules actually loaded, not the item's cached count — if the two
        // ever disagree the ladder on screen is the truth.
        priceRuleCount: priceBands.length,
        priceBands,
      }
    })

  const remaining = Math.max(0, REQUIRED_CONFIRMED_ITEMS - initial.length)

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.back} href="/onboarding">
          ← Einrichtung
        </Link>

        <h1 className={styles.title}>Ihre Leistungen</h1>
        <p className={styles.lede}>
          {remaining > 0
            ? `Alles, was Sie anbieten, mit Ihrem Preis. Noch ${remaining} ` +
              `${remaining === 1 ? 'Leistung' : 'Leistungen'}, dann kann der Assistent ` +
              'Angebote rechnen. Sie können jederzeit weitere ergänzen.'
            : 'Alles, was Sie anbieten, mit Ihrem Preis. Der Assistent rechnet ausschließlich ' +
              'mit diesen Zahlen — er erfindet keine Leistungen und gibt keine Rabatte.'}
        </p>

        <CatalogueEditor initialItems={initial} />

        {initial.length >= REQUIRED_CONFIRMED_ITEMS && (
          <div className={styles.done}>
            <p className={styles.doneNote}>
              Das reicht für den Start. Weitere Leistungen können Sie jederzeit ergänzen.
            </p>
            <Link className={styles.doneLink} href="/onboarding">
              Weiter zur Einrichtung →
            </Link>
          </div>
        )}
      </div>
    </main>
  )
}
