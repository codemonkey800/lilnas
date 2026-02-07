import { DrizzleAdapter } from '@auth/drizzle-adapter'
import NextAuth, { type NextAuthResult } from 'next-auth'
import Nodemailer from 'next-auth/providers/nodemailer'
import { createTransport } from 'nodemailer'

import { db } from 'src/db'
import { accounts, sessions, users, verificationTokens } from 'src/db/schema'
import { html, text } from 'src/email/magic-link'

const nextAuth: NextAuthResult = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),

  providers: [
    Nodemailer({
      server: {
        host: process.env.EMAIL_SERVER_HOST,
        port: Number(process.env.EMAIL_SERVER_PORT),
        auth: {
          user: process.env.EMAIL_SERVER_USER,
          pass: process.env.EMAIL_SERVER_PASSWORD,
        },
      },
      from: process.env.EMAIL_FROM,

      async sendVerificationRequest({
        identifier: email,
        url,
        provider: { server, from },
      }) {
        const { host } = new URL(url)
        const transport = createTransport(server)

        const result = await transport.sendMail({
          to: email,
          from,
          subject: 'Sign in to Sync',
          text: text({ url, host }),
          html: html({ url, host }),
        })

        const failed = result.rejected.concat(result.pending).filter(Boolean)

        if (failed.length) {
          throw new Error(`Email(s) (${failed.join(', ')}) could not be sent`)
        }
      },
    }),
  ],

  pages: {
    signIn: '/login',
  },

  session: {
    strategy: 'database',
  },
})

export const handlers: NextAuthResult['handlers'] = nextAuth.handlers
export const auth: NextAuthResult['auth'] = nextAuth.auth
export const signIn: NextAuthResult['signIn'] = nextAuth.signIn
export const signOut: NextAuthResult['signOut'] = nextAuth.signOut
