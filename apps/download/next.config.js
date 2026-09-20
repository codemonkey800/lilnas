module.exports = {
  output: 'standalone',

  // Required when `next dev` runs behind Traefik TLS (deploy.dev.yml
  // publishes this app at https://download.dev.lilnas.io). Without it Next
  // rejects the cross-origin dev requests and the HMR WebSocket never upgrades.
  // Introduced in Next 15.2; HMR coordinates are derived from the page origin,
  // so no client-port setting is needed. No effect on production builds.
  allowedDevOrigins: ['dev.lilnas.io', '*.dev.lilnas.io'],

  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:8081/:path*',
      },
      {
        source: '/ws/:path*',
        destination: 'http://localhost:8081/ws/:path*',
      },
    ]
  },
}
