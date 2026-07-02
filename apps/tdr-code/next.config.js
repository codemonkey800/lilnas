const backendPort = process.env.BACKEND_PORT ?? '8082'

module.exports = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],

  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `http://localhost:${backendPort}/:path*`,
      },
    ]
  },
}
