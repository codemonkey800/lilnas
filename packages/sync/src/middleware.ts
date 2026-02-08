import NextAuth, { type NextAuthResult } from 'next-auth'

import { authConfig } from 'src/auth.config'

const nextAuth: NextAuthResult = NextAuth(authConfig)

const middleware: NextAuthResult['auth'] = nextAuth.auth
export default middleware

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
