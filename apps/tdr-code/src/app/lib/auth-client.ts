import { createAuthClient } from 'better-auth/react'

// Better Auth's REACT client (not the vanilla `better-auth/client` nanostores
// client, and not a Next.js-specific export — better-auth has no `/next-js`
// client subpath for this shape) — chosen specifically for its `useSession()`
// hook, which returns a reactive `{ data, isPending, isRefetching, error,
// refetch }` shape backed by nanostores under the hood. That hook is what
// lets nav-shell.tsx render a fixed-width loading placeholder while the
// session resolves and re-render the moment it does, without hand-rolling a
// subscription/fetch-on-mount effect around the vanilla client's `$store`.
//
// NO `baseURL` option is passed here — this is deliberate, not an omission,
// and got this way only after a real `next build` failure proved the
// "obviously correct" alternative (`createAuthClient({ baseURL:
// '/api/auth' })`) is actually WRONG. Better Auth's client resolves its
// baseURL through a fallback chain
// (better-auth/dist/client/config.mjs's getClientConfig:
// `getBaseURL(options?.baseURL, ...) ?? resolvePublicAuthUrl(...) ??
// "/api/auth"`), but the paths through that chain are NOT equivalent:
//   - Passing an explicit `options.baseURL` routes into getBaseURL's FIRST
//     branch (`if (url) return withPath(url, path)`), and `withPath` always
//     validates the string via `assertHasProtocol`, which does a bare `new
//     URL(url)` — for a relative path like '/api/auth' (no scheme, no
//     origin), that throws `Invalid URL` UNCONDITIONALLY, in every
//     environment, not just SSR.
//   - Leaving `baseURL` unset skips that branch entirely; every other
//     resolution step in the chain either needs env vars this app doesn't
//     set (NEXT_PUBLIC_AUTH_URL, VERCEL_URL, ...) or `window` (undefined
//     during Next's server-side prerendering of client components at build
//     time — confirmed empirically: `next build` failed prerendering
//     /events with `BetterAuthError: Invalid base URL: /api/auth` the one
//     time this file passed baseURL explicitly), so the WHOLE chain returns
//     undefined and the outer `?? "/api/auth"` fallback supplies the exact
//     same literal WITHOUT ever calling `new URL()` on it.
// Net effect: the relative, same-origin '/api/auth' path this app actually
// wants is what BOTH paths produce in the browser — but only the "don't
// pass baseURL" path also survives Next's server-side prerendering pass,
// which executes this module's top-level `createAuthClient(...)` call even
// though there is no real browser and no window.location to resolve
// against. Every browser-side request through this client still goes
// through Next's existing '/api/:path*' rewrite to the mounted Better Auth
// handler, exactly like every other request this app makes
// (src/app/lib/api.ts's `fetch('/api'+path)` pattern) — this comment exists
// so nobody "fixes" this by re-adding the explicit baseURL and
// reintroducing the build failure.
export const authClient = createAuthClient()

export const { signIn, signOut, useSession } = authClient
