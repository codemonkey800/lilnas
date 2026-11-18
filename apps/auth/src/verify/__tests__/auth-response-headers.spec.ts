import fs from 'fs'
import path from 'path'
import { parse } from 'yaml'

import {
  VERIFY_RESPONSE_HEADERS,
  VERIFY_SANITIZED_HEADERS,
} from 'src/verify/verify.controller'

// S7: guards the invariant VERIFY_RESPONSE_HEADERS's own comment describes —
// infra/proxy.yml's lilnas-auth middleware authResponseHeaders= value MUST
// list exactly the headers /verify actually sets on an 'allow' outcome (the
// identity headers plus the sanitized Cookie).
// Miss one here (in either direction) and either a legitimate consumer's
// header gets stripped by Traefik, or — the impersonation case —
// authResponseHeaders lists a header /verify does NOT control the value
// of, letting a client hand-set it through Traefik as if it came from
// /verify itself.

const REPO_ROOT = path.resolve(__dirname, '../../../../..')
const PROXY_YML_PATH = path.join(REPO_ROOT, 'infra', 'proxy.yml')

type ComposeFile = { services?: Record<string, { labels?: string[] }> }

function readTraefikLabels(): string[] {
  const doc = parse(fs.readFileSync(PROXY_YML_PATH, 'utf-8')) as ComposeFile
  return doc.services?.traefik?.labels ?? []
}

function middlewareLabel(
  labels: string[],
  middleware: string,
  option: string,
): string | undefined {
  const prefix = `traefik.http.middlewares.${middleware}.forwardauth.${option}=`
  const label = labels.find(entry => entry.startsWith(prefix))
  return label?.slice(prefix.length)
}

function requireMiddlewareLabel(middleware: string, option: string): string {
  const value = middlewareLabel(readTraefikLabels(), middleware, option)
  if (value === undefined) {
    throw new Error(
      `expected infra/proxy.yml's traefik service to define a traefik.http.middlewares.${middleware}.forwardauth.${option}=... label`,
    )
  }
  return value
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map(header => header.trim())
    .filter(Boolean)
}

describe('authResponseHeaders invariant (S7)', () => {
  it("infra/proxy.yml's lilnas-auth authResponseHeaders matches VERIFY_RESPONSE_HEADERS and VERIFY_SANITIZED_HEADERS exactly", () => {
    const proxyHeaders = splitList(
      requireMiddlewareLabel('lilnas-auth', 'authResponseHeaders'),
    )
    const expected = [...VERIFY_RESPONSE_HEADERS, ...VERIFY_SANITIZED_HEADERS]

    expect(new Set(proxyHeaders)).toEqual(new Set(expected))
    // Also guards against a duplicate entry on either side inflating the
    // Set comparison above into a false pass (e.g. ['a','a'] vs ['a']
    // would otherwise both collapse to the same Set).
    expect(proxyHeaders).toHaveLength(expected.length)
  })

  it('lilnas-cookie-strip points at /strip-cookie and lists exactly Cookie in authResponseHeaders', () => {
    expect(requireMiddlewareLabel('lilnas-cookie-strip', 'address')).toBe(
      'http://auth:8081/strip-cookie',
    )
    expect(
      splitList(
        requireMiddlewareLabel('lilnas-cookie-strip', 'authResponseHeaders'),
      ),
    ).toEqual(['Cookie'])
  })

  it.each(['lilnas-auth', 'lilnas-cookie-strip'])(
    'the %s middleware has no trustForwardHeader label',
    middleware => {
      const labels = readTraefikLabels()
      const mentioning = labels.filter(
        entry =>
          entry.startsWith(`traefik.http.middlewares.${middleware}.`) &&
          entry.toLowerCase().includes('trustforwardheader'),
      )
      expect(mentioning).toEqual([])
    },
  )
})
