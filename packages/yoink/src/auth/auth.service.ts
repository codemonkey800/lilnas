import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { and, eq } from 'drizzle-orm'
import type { Profile } from 'passport-google-oauth20'

import { db } from 'src/db'
import { accounts, users } from 'src/db/schema'
import { EnvKeys } from 'src/env'

@Injectable()
export class AuthService {
  constructor(private jwtService: JwtService) {}

  async findOrCreateUser(profile: Profile) {
    const email = profile.emails?.[0]?.value
    const googleId = profile.id

    if (!email) throw new Error('No email in Google OAuth profile')

    // Check if this Google account is already linked
    const existingAccount = await db.query.accounts.findFirst({
      where: and(
        eq(accounts.provider, 'google'),
        eq(accounts.providerAccountId, googleId),
      ),
    })

    if (existingAccount) {
      const [updatedUser] = await db
        .update(users)
        .set({
          name: profile.displayName,
          image: profile.photos?.[0]?.value ?? null,
        })
        .where(eq(users.id, existingAccount.userId))
        .returning()
      return updatedUser
    }

    // Find or create user by email
    let user = await db.query.users.findFirst({
      where: eq(users.email, email),
    })

    if (!user) {
      const adminEmail = process.env[EnvKeys.ADMIN_EMAIL]
      const [newUser] = await db
        .insert(users)
        .values({
          email,
          name: profile.displayName,
          image: profile.photos?.[0]?.value ?? null,
          status: email === adminEmail ? 'approved' : 'pending',
        })
        .returning()
      user = newUser!
    }

    // Link the Google account
    await db
      .insert(accounts)
      .values({
        userId: user.id,
        type: 'oauth',
        provider: 'google',
        providerAccountId: googleId,
      })
      .onConflictDoNothing()

    return user
  }

  async login(user: { id: string; email: string }) {
    const payload = { sub: user.id, email: user.email }
    return this.jwtService.signAsync(payload)
  }
}
