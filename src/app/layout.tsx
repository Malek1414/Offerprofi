import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Angebot',
  // Customer-facing quote pages must never be indexed — they carry a named
  // customer, an event date and a price. A tokenised URL is not a secret if
  // a crawler publishes it.
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  )
}
