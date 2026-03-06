import { jwtVerify } from 'jose'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

const AUTH_TOKEN_COOKIE = 'auth-token'

export default async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl

  // Exclude /login and /pending from the auth check so users can reach them.
  if (pathname !== '/login' && pathname !== '/pending') {
    const token = req.cookies.get(AUTH_TOKEN_COOKIE)?.value

    if (!token) {
      const loginUrl = new URL('/login', req.nextUrl.origin)
      loginUrl.searchParams.set('return_to', pathname + search)
      return Response.redirect(loginUrl)
    }

    const secret = new TextEncoder().encode(process.env.JWT_SECRET)
    try {
      await jwtVerify(token, secret)
    } catch {
      const loginUrl = new URL('/login', req.nextUrl.origin)
      loginUrl.searchParams.set('return_to', pathname + search)
      return Response.redirect(loginUrl)
    }
  }

  // Forward the current path as a header so RSC layouts can use it in redirects.
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-pathname', pathname + search)

  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
