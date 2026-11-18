import { COOKIE_PREFIX, SECURE_COOKIE_PREFIX } from 'src/auth/cookie-names'

// Every cookie lilnas-auth's Better Auth instance mints is named
// `lilnas-auth.<x>` (http) or `__Secure-lilnas-auth.<x>` (https): session_token,
// session_data, account_data, dont_remember and the OAuth state cookies. The
// match is by prefix, case-sensitive, from the first character of the name.
const AUTH_COOKIE_NAME_PREFIXES: readonly string[] = [
  `${COOKIE_PREFIX}.`,
  `${SECURE_COOKIE_PREFIX}${COOKIE_PREFIX}.`,
]

function isAuthCookieName(name: string): boolean {
  return AUTH_COOKIE_NAME_PREFIXES.some(prefix => name.startsWith(prefix))
}

/**
 * The Cookie header value with every lilnas-auth cookie removed, or undefined
 * when no other cookie remains (the caller then sends no header at all).
 */
export function stripAuthCookies(
  cookieHeader: string | undefined,
): string | undefined {
  if (!cookieHeader) return undefined

  const kept: string[] = []
  for (const segment of cookieHeader.split(';')) {
    const pair = segment.trim()
    if (!pair) continue

    const separator = pair.indexOf('=')
    const name = (separator === -1 ? pair : pair.slice(0, separator)).trim()
    if (isAuthCookieName(name)) continue

    kept.push(pair)
  }

  return kept.length > 0 ? kept.join('; ') : undefined
}
