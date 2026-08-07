import fs from 'fs'
import path from 'path'
import { parse } from 'yaml'

import { VERIFY_RESPONSE_HEADERS } from 'src/verify/verify.controller'

// S7: guards the invariant VERIFY_RESPONSE_HEADERS's own comment describes —
// infra/proxy.yml's lilnas-auth middleware authResponseHeaders= value MUST
// list exactly the headers /verify actually sets on an 'allow' outcome.
// Miss one here (in either direction) and either a legitimate consumer's
// header gets stripped by Traefik, or — the impersonation case —
// authResponseHeaders lists a header /verify does NOT control the value
// of, letting a client hand-set it through Traefik as if it came from
// /verify itself.

const REPO_ROOT = path.resolve(__dirname, '../../../../..')
const PROXY_YML_PATH = path.join(REPO_ROOT, 'infra', 'proxy.yml')
const AUTH_RESPONSE_HEADERS_PREFIX =
  'traefik.http.middlewares.lilnas-auth.forwardauth.authResponseHeaders='

type ComposeFile = { services?: Record<string, { labels?: string[] }> }

function readLilnasAuthResponseHeaders(): string[] {
  const doc = parse(fs.readFileSync(PROXY_YML_PATH, 'utf-8')) as ComposeFile
  const labels = doc.services?.traefik?.labels ?? []
  const label = labels.find(entry =>
    entry.startsWith(AUTH_RESPONSE_HEADERS_PREFIX),
  )
  if (!label) {
    throw new Error(
      `expected infra/proxy.yml's traefik service to define a ${AUTH_RESPONSE_HEADERS_PREFIX}... label`,
    )
  }
  return label
    .slice(AUTH_RESPONSE_HEADERS_PREFIX.length)
    .split(',')
    .map(header => header.trim())
    .filter(Boolean)
}

describe('authResponseHeaders invariant (S7)', () => {
  it("infra/proxy.yml's lilnas-auth authResponseHeaders matches VERIFY_RESPONSE_HEADERS exactly", () => {
    const proxyHeaders = readLilnasAuthResponseHeaders()

    expect(new Set(proxyHeaders)).toEqual(new Set(VERIFY_RESPONSE_HEADERS))
    // Also guards against a duplicate entry on either side inflating the
    // Set comparison above into a false pass (e.g. ['a','a'] vs ['a']
    // would otherwise both collapse to the same Set).
    expect(proxyHeaders).toHaveLength(VERIFY_RESPONSE_HEADERS.length)
  })
})
