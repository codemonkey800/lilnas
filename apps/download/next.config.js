module.exports = {
  output: 'standalone',

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
