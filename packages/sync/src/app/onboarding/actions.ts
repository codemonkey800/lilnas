'use server'

import { eq } from 'drizzle-orm'

import { auth } from 'src/auth'
import { db } from 'src/db'
import { profiles } from 'src/db/schema'

export interface OnboardingData {
  displayName: string
  birthday: string
  pronouns: string
  loveLang: string
  interests: string[]
  goals: string[]
}

export async function saveProfile(
  data: OnboardingData,
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await auth()

  if (!session?.user?.id) {
    return { success: false, error: 'You must be logged in.' }
  }

  if (!data.displayName.trim()) {
    return { success: false, error: 'Display name is required.' }
  }

  try {
    const existing = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.userId, session.user.id))
      .limit(1)

    if (existing.length) {
      await db
        .update(profiles)
        .set({
          displayName: data.displayName.trim(),
          birthday: data.birthday || null,
          pronouns: data.pronouns || null,
          loveLang: data.loveLang || null,
          interests: JSON.stringify(data.interests),
          goals: JSON.stringify(data.goals),
          onboardingCompleted: true,
          updatedAt: new Date(),
        })
        .where(eq(profiles.userId, session.user.id))
    } else {
      await db.insert(profiles).values({
        userId: session.user.id,
        displayName: data.displayName.trim(),
        birthday: data.birthday || null,
        pronouns: data.pronouns || null,
        loveLang: data.loveLang || null,
        interests: JSON.stringify(data.interests),
        goals: JSON.stringify(data.goals),
        onboardingCompleted: true,
      })
    }

    return { success: true }
  } catch {
    return {
      success: false,
      error: 'Something went wrong. Please try again.',
    }
  }
}
