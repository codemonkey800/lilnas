import type { NextAuthConfig } from 'next-auth'

const PUBLIC_ROUTES = ['/login', '/register']

export const authConfig: NextAuthConfig = {
  pages: {
    signIn: '/login',
  },

  session: {
    strategy: 'jwt',
  },

  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const isPublic = PUBLIC_ROUTES.includes(nextUrl.pathname)

      if (!isLoggedIn && !isPublic) return false
      if (isLoggedIn && isPublic) {
        return Response.redirect(new URL('/', nextUrl))
      }

      return true
    },

    jwt({ token, user }) {
      if (user) {
        token.id = user.id
      }
      return token
    },

    session({ session, token }) {
      if (token.id) {
        session.user.id = token.id as string
      }
      return session
    },
  },

  providers: [], // Providers are added in auth.ts
}
