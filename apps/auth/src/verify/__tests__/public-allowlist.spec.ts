import path from 'node:path'

// Guard for what the internet can reach on the backend. Port 8081 is never
// published; the only backend paths a browser can reach are the
// next.config.js rewrites. Adding a rewrite, or pointing one at an internal
// route, must be a deliberate edit to this file.

type Rewrite = { source: string; destination: string }
type NextConfig = { rewrites: () => Promise<Rewrite[]> }

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

async function loadRewrites(): Promise<Rewrite[]> {
  const configPath = path.resolve(__dirname, '../../../next.config.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const config = require(configPath) as NextConfig
  return config.rewrites()
}

// The path of a rewrite destination. The host is not asserted on (it changes
// between deployments); only what path on the backend is reachable.
function destinationPath(destination: string): string {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(destination)) return destination
  // `:path*` is not valid inside a URL pathname the way the WHATWG parser
  // wants it, so swap it for a plain segment first.
  return new URL(destination.replace(/:path\*/g, 'x')).pathname
}

describe('next.config.js public allowlist', () => {
  it('rewrites exactly the four public sources', async () => {
    const rewrites = await loadRewrites()

    expect(rewrites.map(r => r.source)).toEqual(EXPECTED_SOURCES)
  })

  it.each(NEVER_REACHABLE_PREFIXES)(
    'no rewrite destination path starts with %s',
    async prefix => {
      const rewrites = await loadRewrites()

      const offenders = rewrites
        .map(r => r.destination)
        .filter(destination => destinationPath(destination).startsWith(prefix))

      expect(offenders).toEqual([])
    },
  )

  it('reads the path from an absolute destination URL', () => {
    expect(destinationPath('http://localhost:8081/verify')).toBe('/verify')
    expect(destinationPath('http://h:1/sse/:path*')).toBe('/sse/x')
    expect(destinationPath('/strip-cookie')).toBe('/strip-cookie')
  })
})
