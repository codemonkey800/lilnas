module.exports = {
  output: 'standalone',

  // Required when `next dev` runs behind Traefik TLS (deploy.dev.yml
  // publishes this app at https://tdr.dev.lilnas.io). Without it Next rejects
  // the cross-origin dev requests and the HMR WebSocket never upgrades. No
  // effect on production builds.
  allowedDevOrigins: ['dev.lilnas.io', '*.dev.lilnas.io'],

  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:8081/:path*',
      },
    ]
  },
}
