import type { NextProxy } from 'next/server'
import NextAuth from 'next-auth'

import authConfig from 'src/auth.config'

const { auth } = NextAuth(authConfig)

export default auth(req => {
  if (!req.auth && req.nextUrl.pathname !== '/login') {
    const loginUrl = new URL('/login', req.nextUrl.origin)
    return Response.redirect(loginUrl)
  }

  return undefined
}) as unknown as NextProxy

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
