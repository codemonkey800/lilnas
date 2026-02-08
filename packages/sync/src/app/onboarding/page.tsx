import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'

import { auth } from 'src/auth'
import { db } from 'src/db'
import { profiles } from 'src/db/schema'

import { OnboardingWizard } from './onboarding-wizard'

export const dynamic = 'force-dynamic'

export default async function OnboardingPage() {
  const session = await auth()

  if (!session?.user) {
    redirect('/login')
  }

  // If user already completed onboarding, send them home
  const existing = await db
    .select({ onboardingCompleted: profiles.onboardingCompleted })
    .from(profiles)
    .where(eq(profiles.userId, session.user.id!))
    .limit(1)

  if (existing[0]?.onboardingCompleted) {
    redirect('/')
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <OnboardingWizard />
    </main>
  )
}
