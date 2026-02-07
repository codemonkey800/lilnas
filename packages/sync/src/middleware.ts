import type { NextFetchEvent } from 'next/server'
import { NextResponse } from 'next/server'

import { auth } from 'src/auth'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default auth((req, _ctx: NextFetchEvent) => {
  if (!req.auth && req.nextUrl.pathname !== '/login') {
    const loginUrl = new URL('/login', req.nextUrl.origin)
    return NextResponse.redirect(loginUrl)
  }

  if (req.auth && req.nextUrl.pathname === '/login') {
    const homeUrl = new URL('/', req.nextUrl.origin)
    return NextResponse.redirect(homeUrl)
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
  runtime: 'nodejs',
}
