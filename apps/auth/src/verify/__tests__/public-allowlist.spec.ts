import path from 'node:path'

import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from 'next/constants'

// Guard for what the internet can reach on the backend. Port 8081 is never
// published; the only backend paths a browser can reach are the
// next.config.js rewrites. Adding a rewrite, or pointing one at an internal
// route, must be a deliberate edit to this file.

type Rewrite = { source: string; destination: string }
type NextConfigObject = { rewrites: () => Promise<Rewrite[]> }
type NextConfigFactory = ((phase: string) => NextConfigObject) & {
  DEV_BACKEND_ORIGIN: string
  PROD_BACKEND_ORIGIN: string
}

// Next's build phases (next/constants). `next dev` is the development server;
// `next build` and `next start` take the production origin.
const PHASES = [
  ['development', PHASE_DEVELOPMENT_SERVER, 'http://localhost:8081'],
  ['production build', PHASE_PRODUCTION_BUILD, 'http://auth:8081'],
  ['production server', PHASE_PRODUCTION_SERVER, 'http://auth:8081'],
] as const

const EXPECTED_SOURCES = [
  '/api/auth/:path*',
  '/.well-known/openid-configuration',
  '/.well-known/oauth-authorization-server',
  '/api/sse/:path*',
]

const NEVER_REACHABLE_PREFIXES = [
  '/verify',
  '/strip-cookie',
  '/internal',
  '/admin',
  '/me',
  '/requests',
  '/health',
]

function loadConfig(): NextConfigFactory {
  const configPath = path.resolve(__dirname, '../../../next.config.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(configPath) as NextConfigFactory
}

async function loadRewrites(phase: string): Promise<Rewrite[]> {
  return loadConfig()(phase).rewrites()
}

// The path of a rewrite destination. The origin is asserted separately (per
// build phase); this is only what path on the backend is reachable.
function destinationPath(destination: string): string {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(destination)) return destination
  // `:path*` is not valid inside a URL pathname the way the WHATWG parser
  // wants it, so swap it for a plain segment first.
  return new URL(destination.replace(/:path\*/g, 'x')).pathname
}

describe.each(PHASES)(
  'next.config.js public allowlist (%s phase)',
  (_label, phase, origin) => {
    it('rewrites exactly the four public sources', async () => {
      const rewrites = await loadRewrites(phase)

      expect(rewrites.map(r => r.source)).toEqual(EXPECTED_SOURCES)
    })

    it.each(NEVER_REACHABLE_PREFIXES)(
      'no rewrite destination path starts with %s',
      async prefix => {
        const rewrites = await loadRewrites(phase)

        const offenders = rewrites
          .map(r => r.destination)
          .filter(destination =>
            destinationPath(destination).startsWith(prefix),
          )

        expect(offenders).toEqual([])
      },
    )

    it(`sends every rewrite to ${origin}`, async () => {
      const rewrites = await loadRewrites(phase)

      expect(
        rewrites.map(
          r => new URL(r.destination.replace(/:path\*/g, 'x')).origin,
        ),
      ).toEqual(rewrites.map(() => origin))
    })
  },
)

describe('next.config.js backend origins', () => {
  it('exports the development and production origins', () => {
    const config = loadConfig()

    expect(config.DEV_BACKEND_ORIGIN).toBe('http://localhost:8081')
    expect(config.PROD_BACKEND_ORIGIN).toBe('http://auth:8081')
  })

  it('keeps output and serverExternalPackages', () => {
    const config = loadConfig()(PHASE_PRODUCTION_BUILD) as NextConfigObject &
      Record<string, unknown>

    expect(config.output).toBe('standalone')
    expect(config.serverExternalPackages).toEqual(['better-sqlite3'])
  })
})

describe('destinationPath', () => {
  it('reads the path from an absolute destination URL', () => {
    expect(destinationPath('http://localhost:8081/verify')).toBe('/verify')
    expect(destinationPath('http://h:1/sse/:path*')).toBe('/sse/x')
    expect(destinationPath('/strip-cookie')).toBe('/strip-cookie')
  })
})
