import { env } from '@lilnas/utils/env'

import { resolveRedirectTarget } from 'src/auth/redirect'
import { EnvKeys } from 'src/env'

import { LoginForm } from './login-form'

type LoginPageProps = {
  searchParams: Promise<{
    redirect?: string | string[]
  }>
}

// U4: deliberately a Server Component (no 'use client'), NOT the
// pre-U4 shape where this file itself was the client component. This is
// what lets AUTH_HOST / REDIRECT_ALLOWED_SUFFIX be read from this
// process's real, request-time `process.env` — via the same env()/EnvKeys
// pattern src/auth/auth.ts already uses — and fed into
// resolveRedirectTarget() entirely server-side.
//
// Reading these here rather than inside a 'use client' module is not a
// style preference: Next.js bundles whatever a 'use client' file imports
// into the BROWSER bundle too, and only NEXT_PUBLIC_-prefixed vars get
// statically inlined into that bundle, and only at `next build` time. This
// app's Dockerfile runs `next build` before .env.prod is ever available to
// the process — .env.prod is loaded via docker-compose's `env_file:` at
// container RUNTIME (deploy.yml), not present in the `docker build`
// context's environment at all. A NEXT_PUBLIC_ var here would therefore
// bake in an undefined/stale value permanently, with no way to fix it
// short of a rebuild. Keeping the redirect-validation config entirely
// server-side avoids that trap and needs no new NEXT_PUBLIC_ surface.
//
// Splitting the interactive button + error notice into LoginForm (its own
// 'use client' file) is what makes this possible: a single file can't mix
// a server-only async component with 'use client' exports, since the
// directive applies to the whole module, not per-export.
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { redirect } = await searchParams

  const callbackURL = resolveRedirectTarget(
    // Next collapses a repeated `?redirect=a&redirect=b` query key into a
    // string[] — resolveRedirectTarget's own `unknown` parameter type
    // means it would already treat that safely as "not a valid candidate"
    // (falls back to the default), but narrowing here keeps the intent
    // explicit: this page only ever considers a SINGLE string value, never
    // guesses which array element the caller meant.
    typeof redirect === 'string' ? redirect : undefined,
    {
      authHost: env(EnvKeys.AUTH_HOST),
      allowedSuffix: env(EnvKeys.REDIRECT_ALLOWED_SUFFIX),
      // Same-origin relative literal — safe in every environment, and
      // matches this page's own pre-U4 hardcoded behavior for "no valid
      // redirect supplied".
      defaultDestination: '/',
    },
  )

  // The mock's "Continuing to <host>" target pill. Safe to call new URL()
  // unconditionally when callbackURL isn't the literal default — see
  // resolveRedirectTarget()'s own contract comment: it returns EITHER
  // config.defaultDestination ('/') verbatim, OR the original candidate
  // string verbatim after that candidate already parsed successfully as a
  // URL, never anything in between.
  const targetHost = callbackURL === '/' ? null : new URL(callbackURL).hostname

  return <LoginForm callbackURL={callbackURL} targetHost={targetHost} />
}
