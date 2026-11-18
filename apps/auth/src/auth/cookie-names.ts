// The cookie names lilnas-auth's Better Auth instance mints.
//
// Better Auth's default prefix ('better-auth') is shared with every other app
// under *.lilnas.io that runs its own Better Auth (see apps/tdr-code/src/
// proxy.ts), so lilnas-auth uses its own. Anything that strips or matches
// lilnas-auth's cookies by name relies on these being unambiguous.

export const COOKIE_PREFIX = 'lilnas-auth'
export const SECURE_COOKIE_PREFIX = '__Secure-'

const SESSION_TOKEN_SUFFIX = 'session_token'

/** `lilnas-auth.session_token` (http) and `__Secure-lilnas-auth.session_token` (https). */
export const SESSION_COOKIE_NAMES: readonly [string, string] = [
  `${COOKIE_PREFIX}.${SESSION_TOKEN_SUFFIX}`,
  `${SECURE_COOKIE_PREFIX}${COOKIE_PREFIX}.${SESSION_TOKEN_SUFFIX}`,
]
