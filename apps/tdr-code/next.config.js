module.exports = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],

  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:8082/:path*',
      },
    ]
  },
}
