import { NextRequest } from 'next/server'

import { config, middleware, NOT_FOUND_REWRITE } from 'src/middleware'

const ORIGIN = 'https://download.lilnas.io'

function run(path: string) {
  return middleware(new NextRequest(`${ORIGIN}${path}`))
}

/** Where Next is told to serve the request from, or `null` to pass it through. */
function rewriteOf(path: string): string | null {
  return run(path).headers.get('x-middleware-rewrite')
}

describe('middleware', () => {
  it.each(['/movies/438631', '/shows/121361', '/videos/V1StGXR8_Z5jdHi6B-myT'])(
    'passes a well-formed %s through untouched',
    path => {
      const response = run(path)

      expect(response.headers.get('x-middleware-next')).toBe('1')
      expect(rewriteOf(path)).toBeNull()
    },
  )

  it.each([
    '/movies/abc',
    '/movies/0',
    '/movies/0438631',
    '/movies/99999999999999999999',
    '/shows/abc',
    '/shows/-1',
    // The smuggling case the page guard documents: a movie key through the
    // video route.
    '/videos/tmdb%3A438631',
    '/videos/has%20space',
    `/videos/${'a'.repeat(65)}`,
  ])('rewrites a malformed %s to the not-found route', path => {
    expect(rewriteOf(path)).toBe(`${ORIGIN}${NOT_FOUND_REWRITE}`)
  })

  it('⚠️ decodes the segment first, as the page sees it', () => {
    // `%31%32` is `12`, which the page would accept — so this must too.
    expect(rewriteOf('/movies/%31%32')).toBeNull()
  })

  it('refuses a segment that does not percent-decode at all', () => {
    expect(rewriteOf('/movies/%E0%A4%A')).toBe(`${ORIGIN}${NOT_FOUND_REWRITE}`)
  })

  it('leaves the address bar alone — a rewrite, never a redirect', () => {
    const response = run('/shows/abc')

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('only runs on the three detail routes', () => {
    expect(config.matcher).toEqual(['/movies/:id', '/shows/:id', '/videos/:id'])
  })
})
