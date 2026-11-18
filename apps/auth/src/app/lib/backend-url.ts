import { env } from '@lilnas/utils/env'

import { EnvKeys } from 'src/env'

// The origin AUTH_BACKEND_URL must be: http(s) scheme + host (+ port), with
// nothing after it. A trailing slash is the one tolerated deviation (typo
// forgiveness for a hand-edited env file).
function parseBackendOrigin(raw: string): string {
  const fail = (): never => {
    throw new Error(
      `${EnvKeys.AUTH_BACKEND_URL} must be an http: or https: origin with no path, query or credentials (e.g. http://auth:8081)`,
    )
  }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return fail()
  }

  const hasForbiddenParts =
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.pathname !== '/' ||
    // `new URL()` normalizes a bare origin to pathname '/', so a trailing
    // slash can't be told apart from none by pathname alone; compare the
    // raw text instead. Exactly one trailing slash is allowed, and a '?' or
    // '#' with an empty value (`http://h?`) is caught here too.
    !/^https?:\/\/[^/?#@]+\/?$/i.test(raw)

  if (hasForbiddenParts) return fail()
  return url.origin
}

/**
 * Absolute URL of a backend path as seen from the Next server.
 * Origin: AUTH_BACKEND_URL when set, else http://localhost:${BACKEND_PORT}.
 */
export function backendUrl(path: string): string {
  // Read per call, never at module load: the value comes from the process
  // environment at request time.
  const configured = process.env[EnvKeys.AUTH_BACKEND_URL]
  const origin =
    configured !== undefined && configured !== ''
      ? parseBackendOrigin(configured)
      : `http://localhost:${env(EnvKeys.BACKEND_PORT)}`

  return `${origin}${path}`
}
