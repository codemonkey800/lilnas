module.exports = {
  output: 'standalone',

  async rewrites() {
    const backendPort = process.env.BACKEND_PORT ?? '8081'
    return [
      {
        source: '/api/:path*',
        destination: `http://localhost:${backendPort}/:path*`,
      },
    ]
  },
}
