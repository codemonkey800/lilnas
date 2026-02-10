import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { auth } from 'src/auth'
import { NavBar } from 'src/components/nav-bar'
import { db } from 'src/db'
import { profiles } from 'src/db/schema'

export const dynamic = 'force-dynamic'

interface AppLayoutProps {
  children: ReactNode
}

export default async function AppLayout({ children }: AppLayoutProps) {
  const session = await auth()

  const userId = session?.user?.id

  if (!userId) {
    redirect('/login')
  }

  const [profile] = await db
    .select({
      displayName: profiles.displayName,
      onboardingCompleted: profiles.onboardingCompleted,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1)

  if (!profile?.onboardingCompleted) {
    redirect('/onboarding')
  }

  const displayName = profile.displayName ?? 'User'
  const avatarInitial = displayName.charAt(0)

  return (
    <>
      <NavBar displayName={displayName} avatarInitial={avatarInitial} />

      <main className="mx-auto w-full max-w-2xl px-4 pt-20 pb-24 md:px-6 md:pb-8 lg:px-8">
        {children}
      </main>
    </>
  )
}
