import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'

import { auth, signOut } from 'src/auth'
import { db } from 'src/db'
import { profiles } from 'src/db/schema'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const session = await auth()

  if (!session?.user) {
    redirect('/login')
  }

  // Redirect new users to onboarding
  const profile = await db
    .select({ onboardingCompleted: profiles.onboardingCompleted })
    .from(profiles)
    .where(eq(profiles.userId, session.user.id!))
    .limit(1)

  if (!profile[0]?.onboardingCompleted) {
    redirect('/onboarding')
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 animate-fade-in">
      <h1 className="text-4xl font-bold tracking-tight">Sync</h1>
      <p className="text-lg text-text-secondary">
        You are logged in as{' '}
        <span className="font-medium text-primary-300">
          {session.user.email}
        </span>
      </p>
      <form
        action={async () => {
          'use server'
          await signOut({ redirectTo: '/login' })
        }}
      >
        <button
          type="submit"
          className="rounded-md bg-bg-surface px-5 py-2.5 text-sm font-medium text-text transition-colors duration-150 ease-smooth hover:bg-bg-overlay focus-visible:shadow-focus"
        >
          Sign out
        </button>
      </form>
    </main>
  )
}
