import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'

import { auth } from 'src/auth'
import { db } from 'src/db'
import { profiles } from 'src/db/schema'

import { ProfileEditForm } from './profile-edit-form'

export const metadata = {
  title: 'Profile Settings — Sync',
}

export const dynamic = 'force-dynamic'

export default async function ProfileSettingsPage() {
  const session = await auth()
  const userId = session?.user?.id

  // Layout guarantees auth + onboarding, but redirect defensively
  if (!userId) {
    redirect('/login')
  }

  const [profile] = await db
    .select({
      displayName: profiles.displayName,
      birthday: profiles.birthday,
      pronouns: profiles.pronouns,
      loveLang: profiles.loveLang,
      interests: profiles.interests,
      goals: profiles.goals,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1)

  if (!profile) {
    redirect('/onboarding')
  }

  return (
    <div className="flex flex-col gap-6 py-8 animate-fade-in">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
          Profile Settings
        </h1>
        <p className="text-text-secondary">
          Update your personal information and preferences.
        </p>
      </div>

      <ProfileEditForm initialData={profile} />
    </div>
  )
}
