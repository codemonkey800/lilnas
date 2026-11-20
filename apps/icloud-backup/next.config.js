const { PHASE_DEVELOPMENT_SERVER } = require('next/constants')

// Where the rewrites below send a request. Rewrites are evaluated when
// `next build` writes the routes manifest and are baked into the build, so the
// origin cannot come from an env var or build argument at deploy time: the
// production hostname is fixed here.
//
// `icloud-backup` is the backend's compose service name, reachable from the
// separate frontend container (deploy.yml's icloud-backup-frontend). `next dev`
// runs both processes in one dev container, where the backend is on localhost.
const DEV_BACKEND_ORIGIN = 'http://localhost:8081'
const PROD_BACKEND_ORIGIN = 'http://icloud-backup:8081'

/** @param {string} phase Next's build phase (see next/constants) */
function nextConfig(phase) {
  const backend =
    phase === PHASE_DEVELOPMENT_SERVER
      ? DEV_BACKEND_ORIGIN
      : PROD_BACKEND_ORIGIN

  return {
    output: 'standalone',

    // Required when `next dev` runs behind Traefik TLS
    // (https://icloud-backup.dev.lilnas.io). Without it Next rejects the
    // cross-origin dev requests and the HMR WebSocket never upgrades. No
    // effect on production builds.
    allowedDevOrigins: ['icloud-backup.dev.lilnas.io', '*.dev.lilnas.io'],

    async rewrites() {
      return [
        { source: '/api/:path*', destination: `${backend}/:path*` },
        { source: '/ws', destination: `${backend}/ws` },
      ]
    },
  }
}

// Exported so specs can assert the origins without re-deriving them.
nextConfig.DEV_BACKEND_ORIGIN = DEV_BACKEND_ORIGIN
nextConfig.PROD_BACKEND_ORIGIN = PROD_BACKEND_ORIGIN

module.exports = nextConfig
