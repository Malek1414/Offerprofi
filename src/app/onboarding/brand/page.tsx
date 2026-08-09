import type { Metadata } from 'next'
import Link from 'next/link'

import styles from './brand.module.css'
import { BrandClient } from './brand-client'
import { requireUserId } from '../../../auth/current-user'
import { DEFAULT_BRAND } from '../../../lib/theme'
import { branding } from '../../../lib/branding'
import { currentAgency, loadBrandProfile } from '../../../onboarding/repository'

export const metadata: Metadata = { title: 'Markenauftritt' }

export default async function BrandPage() {
  const userId = await requireUserId('/onboarding/brand')
  const agency = await currentAgency(userId)
  const brand = branding()

  if (!agency) {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <h1 className={styles.title}>Kein Unternehmen verknüpft</h1>
        </div>
      </main>
    )
  }

  const profile = await loadBrandProfile(userId, agency.agencyId)

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.back} href="/onboarding">← Einrichtung</Link>
        <h1 className={styles.title}>Ihr Markenauftritt</h1>
        <p className={styles.lede}>
          Der Kunde sieht Ihre Marke, nicht {brand.productName}. Wählen Sie die Farbe, die zu Ihrem
          Unternehmen gehört; die Darstellung bleibt auf hellen und dunklen Geräten lesbar.
        </p>

        <BrandClient
          agencyName={agency.agencyName}
          initialColor={profile?.colorPrimary ?? DEFAULT_BRAND}
          confirmed={profile?.confirmed ?? false}
        />
      </div>
    </main>
  )
}
