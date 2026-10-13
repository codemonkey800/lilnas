module.exports = {
  output: 'standalone',

  // Lets HMR and dev resources load when the dev server is reached through
  // theater.dev.lilnas.io (deploy.dev.yml) instead of localhost.
  allowedDevOrigins: ['*.dev.lilnas.io'],

  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `http://localhost:${process.env.BACKEND_PORT ?? 8081}/:path*`,
      },
    ]
  },
}
