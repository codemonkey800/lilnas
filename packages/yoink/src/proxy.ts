import type { NextProxy } from 'next/server'
import { NextResponse } from 'next/server'
import NextAuth from 'next-auth'

import authConfig from 'src/auth.config'

const { auth } = NextAuth(authConfig)

export default auth(req => {
  const { pathname, search } = req.nextUrl

  if (!req.auth && pathname !== '/login') {
    const loginUrl = new URL('/login', req.nextUrl.origin)

    loginUrl.searchParams.set('return_to', pathname + search)

    return Response.redirect(loginUrl)
  }

  // Forward the current path as a header so RSC layouts can use it in redirects.
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-pathname', pathname + search)

  return NextResponse.next({ request: { headers: requestHeaders } })
}) as unknown as NextProxy

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
