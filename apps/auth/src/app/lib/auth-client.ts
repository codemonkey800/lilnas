import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import { createAuthClient } from 'better-auth/react'

// Not in U3's listed file set, but required by it: the plan's own
// instructions for this unit say the login page "needs a client-side
// `authClient` too" and point at
// apps/tdr-code/src/app/lib/auth-client.ts as the pattern to read in full
// before writing this file. That file's entire header comment is the
// justification for the one load-bearing decision here — repeated in short
// form below, full trace in that file.
//
// NO `baseURL` option is passed to createAuthClient() here — deliberate,
// not an omission, and the exact same trap apps/tdr-code/src/app/lib/
// auth-client.ts documents from a real `next build` failure. Passing an
// explicit `baseURL` routes into Better Auth's client config resolution at
// a branch that does a bare `new URL(baseURL)` — for a relative path like
// '/api/auth' (no scheme, no origin), that throws `Invalid URL`
// unconditionally, and that branch is reached during Next's server-side
// prerendering of this client component (no `window` to resolve a relative
// URL against) even though this page is never actually rendered on a
// server for a real user. Omitting `baseURL` entirely makes the client fall
// back to the same '/api/auth' literal WITHOUT ever calling `new URL()` on
// it — the same, same-origin, relative path this app wants in the browser,
// reached via next.config.js's '/api/auth/:path*' rewrite (this app's own
// non-stripping rewrite, unlike tdr-code's app-wide one — but the
// client-side trap and its fix are identical either way, since both
// resolve to the same relative '/api/auth' default).
//
// `oauthProviderClient()` is what lets an OIDC authorize survive the Google
// round trip. /oauth2/authorize redirects a session-less user to
// /login?client_id=…&sig=…; the provider resumes that authorize after
// sign-in ONLY if the sign-in request body carried the signed query as
// `oauth_query` (its `hooks.before` stashes it in the OAuth state, its
// `hooks.after` redirects to the client with a code). The plugin's
// `oauth-provider-signin` fetch plugin
// (node_modules/@better-auth/oauth-provider/dist/client.mjs) injects
// `oauth_query: buildSignedOAuthQuery(window.location.search)` into every
// non-GET request body, so login-form.tsx needs no change for the resume —
// and on a plain /login visit (no `sig`) it injects nothing.
export const authClient = createAuthClient({
  plugins: [oauthProviderClient()],
})

export const { signIn, signOut, useSession } = authClient
