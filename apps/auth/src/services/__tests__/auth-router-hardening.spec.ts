import fs from 'fs'
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from 'next/constants'
import path from 'path'
import { parse } from 'yaml'

// Guards the hardening of the public `auth` router (auth.lilnas.io) in
// apps/auth/deploy.yml: security headers and a per-IP in-flight limit as
// Traefik middlewares, and no `x-powered-by` header from Next.

const REPO_ROOT = path.resolve(__dirname, '../../../../..')

type ComposeService = {
  labels?: string[] | Record<string, unknown>
}
type ComposeFile = { services: Record<string, ComposeService> }

// Compose accepts both list (`KEY=value`) and map forms; normalise to pairs.
function toEntries(
  value: string[] | Record<string, unknown> | undefined,
): Array<[string, string]> {
  if (!value) return []
  if (Array.isArray(value)) {
    return value.map(item => {
      const index = item.indexOf('=')
      return index === -1
        ? [item, '']
        : [item.slice(0, index), item.slice(index + 1)]
    })
  }
  return Object.entries(value).map(([key, val]) => [key, String(val ?? '')])
}

const compose = parse(
  fs.readFileSync(path.join(REPO_ROOT, 'apps/auth/deploy.yml'), 'utf-8'),
) as ComposeFile

const frontend = compose.services['auth-frontend']
if (!frontend) throw new Error('deploy.yml has no service named auth-frontend')

const frontendLabels = new Map(toEntries(frontend.labels))
const allLabels = Object.values(compose.services).flatMap(service =>
  toEntries(service.labels),
)

const MIDDLEWARE_LABELS: Array<[string, string]> = [
  [
    'traefik.http.middlewares.auth-security-headers.headers.stsseconds',
    '31536000',
  ],
  ['traefik.http.middlewares.auth-security-headers.headers.framedeny', 'true'],
  [
    'traefik.http.middlewares.auth-security-headers.headers.contenttypenosniff',
    'true',
  ],
  [
    'traefik.http.middlewares.auth-security-headers.headers.contentsecuritypolicy',
    "frame-ancestors 'none'",
  ],
  ['traefik.http.middlewares.auth-inflight.inflightreq.amount', '64'],
  [
    'traefik.http.middlewares.auth-inflight.inflightreq.sourcecriterion.ipstrategy.depth',
    '0',
  ],
]

describe('auth router hardening', () => {
  it('chains the headers middleware before the in-flight limit', () => {
    expect(frontendLabels.get('traefik.http.routers.auth.middlewares')).toBe(
      'auth-security-headers,auth-inflight',
    )
  })

  it.each(MIDDLEWARE_LABELS)('sets %s=%s on auth-frontend', (name, value) => {
    expect(frontendLabels.get(name)).toBe(value)
  })

  it('limits HSTS to this host (no includeSubDomains, no preload)', () => {
    const widening = allLabels
      .map(([name]) => name)
      .filter(name =>
        /^traefik\.http\.middlewares\.auth-security-headers\.headers\.(stsincludesubdomains|stspreload)$/i.test(
          name,
        ),
      )
    expect(widening).toEqual([])
  })

  it('defines no middleware whose name contains lilnas-auth', () => {
    const names = allLabels
      .map(([name]) => /^traefik\.http\.middlewares\.([^.]+)\./.exec(name)?.[1])
      .filter((name): name is string => Boolean(name))
    expect(names.length).toBeGreaterThan(0)
    expect(names.filter(name => name.includes('lilnas-auth'))).toEqual([])
  })

  it.each([
    PHASE_PRODUCTION_BUILD,
    PHASE_PRODUCTION_SERVER,
    PHASE_DEVELOPMENT_SERVER,
  ])('next.config.js turns off x-powered-by in %s', phase => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nextConfig = require(
      path.join(REPO_ROOT, 'apps/auth/next.config.js'),
    ) as (phase: string) => { poweredByHeader?: boolean }
    expect(nextConfig(phase).poweredByHeader).toBe(false)
  })
})
