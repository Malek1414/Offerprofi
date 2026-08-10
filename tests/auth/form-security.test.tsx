/**
 * Authentication forms must remain safe before React hydrates.
 *
 * Client-side handlers normally send JSON, but a blocked or failed script leaves the
 * browser's native form behaviour in charge. HTML defaults forms to GET, which puts
 * every named field — including the password — in the URL, browser history and
 * access logs. An explicit POST makes that failure safe even when JavaScript never
 * runs.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { LoginForm } from '../../src/app/(auth)/login/login-form'
import { SignupForm } from '../../src/app/(auth)/signup/signup-form'

describe('F0.6 — authentication form transport', () => {
  it.each([
    ['login', <LoginForm next="/" />, '/api/auth/login'],
    ['signup', <SignupForm chatDomain="https://chat.example" />, '/api/auth/signup'],
  ])('%s never falls back to a credential-bearing GET', (_name, form, action) => {
    const html = renderToStaticMarkup(form)

    expect(html).toContain('type="password"')
    expect(html).toContain('method="post"')
    expect(html).toContain(`action="${action}"`)
  })
})
