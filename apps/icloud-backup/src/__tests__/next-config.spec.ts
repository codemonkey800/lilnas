import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
} from 'next/constants'

// next.config.js is plain CommonJS, so it is required, not imported.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextConfig = require('../../next.config.js') as {
  (phase: string): {
    output: string
    rewrites: () => Promise<{ source: string; destination: string }[]>
  }
}

describe('next.config.js', () => {
  it('builds a standalone app', () => {
    expect(nextConfig(PHASE_PRODUCTION_BUILD).output).toBe('standalone')
  })

  it('rewrites /api and /ws to localhost:8081 under the dev server', async () => {
    const rewrites = await nextConfig(PHASE_DEVELOPMENT_SERVER).rewrites()

    expect(rewrites).toEqual([
      { source: '/api/:path*', destination: 'http://localhost:8081/:path*' },
      { source: '/ws', destination: 'http://localhost:8081/ws' },
    ])
  })

  it('rewrites to the compose service name in any other phase', async () => {
    const rewrites = await nextConfig(PHASE_PRODUCTION_BUILD).rewrites()

    expect(rewrites).toEqual([
      {
        source: '/api/:path*',
        destination: 'http://icloud-backup:8081/:path*',
      },
      { source: '/ws', destination: 'http://icloud-backup:8081/ws' },
    ])
  })
})
