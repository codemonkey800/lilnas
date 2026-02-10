'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { auth } from 'src/auth'
import { db } from 'src/db'
import { profiles } from 'src/db/schema'

export interface ProfileData {
  displayName: string
  birthday: string
  pronouns: string
  loveLang: string
  interests: string[]
  goals: string[]
}

export async function updateProfile(
  data: ProfileData,
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await auth()

  if (!session?.user?.id) {
    return { success: false, error: 'You must be logged in.' }
  }

  if (!data.displayName.trim()) {
    return { success: false, error: 'Display name is required.' }
  }

  try {
    await db
      .update(profiles)
      .set({
        displayName: data.displayName.trim(),
        birthday: data.birthday || null,
        pronouns: data.pronouns || null,
        loveLang: data.loveLang || null,
        interests: JSON.stringify(data.interests),
        goals: JSON.stringify(data.goals),
        updatedAt: new Date(),
      })
      .where(eq(profiles.userId, session.user.id))

    revalidatePath('/settings/profile')
    revalidatePath('/')

    return { success: true }
  } catch {
    return {
      success: false,
      error: 'Something went wrong. Please try again.',
    }
  }
}
