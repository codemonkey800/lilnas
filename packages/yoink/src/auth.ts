import { DrizzleAdapter } from '@auth/drizzle-adapter'
import NextAuth, { type NextAuthResult } from 'next-auth'

import authConfig from 'src/auth.config'
import { db } from 'src/db'
import { accounts, sessions, users, verificationTokens } from 'src/db/schema'

const nextAuth: NextAuthResult = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
})

export const handlers: NextAuthResult['handlers'] = nextAuth.handlers
export const auth: NextAuthResult['auth'] = nextAuth.auth
export const signIn: NextAuthResult['signIn'] = nextAuth.signIn
export const signOut: NextAuthResult['signOut'] = nextAuth.signOut
