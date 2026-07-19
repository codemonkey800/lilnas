module.exports = {
  output: 'standalone',

  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `http://localhost:${process.env.BACKEND_PORT ?? 8081}/:path*`,
      },
    ]
  },
}
