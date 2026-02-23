import { DrizzleAdapter } from '@auth/drizzle-adapter'
import NextAuth, { type NextAuthResult } from 'next-auth'
import Google from 'next-auth/providers/google'

import { db } from 'src/db'
import { accounts, sessions, users, verificationTokens } from 'src/db/schema'

const nextAuth: NextAuthResult = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [Google],
})

export const handlers: NextAuthResult['handlers'] = nextAuth.handlers
export const auth: NextAuthResult['auth'] = nextAuth.auth
export const signIn: NextAuthResult['signIn'] = nextAuth.signIn
export const signOut: NextAuthResult['signOut'] = nextAuth.signOut
