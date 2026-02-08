'use server'

import { eq } from 'drizzle-orm'

import { db } from 'src/db'
import { users } from 'src/db/schema'
import { hashPassword } from 'src/lib/password'

export async function register(
  formData: FormData,
): Promise<{ success: true } | { success: false; error: string }> {
  const email = formData.get('email')
  const password = formData.get('password')

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return { success: false, error: 'Please enter a valid email address.' }
  }

  if (!password || typeof password !== 'string' || password.length < 8) {
    return {
      success: false,
      error: 'Password must be at least 8 characters.',
    }
  }

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  if (existing) {
    return {
      success: false,
      error: 'An account with this email already exists.',
    }
  }

  const passwordHash = await hashPassword(password)

  await db.insert(users).values({ email, passwordHash })

  return { success: true }
}
