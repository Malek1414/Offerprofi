import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // Browser-based local QA uses both spellings. Next treats 127.0.0.1 as a
  // different development origin from localhost and otherwise blocks the client
  // chunks, leaving interactive forms unhydrated.
  allowedDevOrigins: ['127.0.0.1'],
  // This repo sits under a home directory that also has a lockfile; pin the root
  // so tracing does not wander up and pull in unrelated files.
  outputFileTracingRoot: import.meta.dirname,
  // F1.12 — zero third-party origins on customer-facing surfaces. The CSP below is
  // what makes the TDDDG §25 "no consent banner" position true, not just claimed.
  async headers() {
    // Next's dev HMR compiles modules through eval(), which a correct CSP blocks —
    // the symptom is a client component that renders but never hydrates, so nothing
    // responds to a click. Production builds do not use eval, so the allowance is
    // scoped to development rather than the policy being weakened everywhere.
    const isDev = process.env.NODE_ENV === 'development'
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      "base-uri 'self'",
    ].join('; ')
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },
}

export default config
