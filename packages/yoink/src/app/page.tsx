import { redirect } from 'next/navigation'

import { signOutAction } from 'src/app/login/actions'
import { getAuthenticatedUser } from 'src/lib/user-status'

export default async function Home() {
  const user = await getAuthenticatedUser()

  if (!user) redirect('/login')
  if (user.status === 'pending') redirect('/pending')
  if (user.status === 'denied') redirect('/login')

  return (
    <main className="flex min-h-screen items-center justify-center gap-6">
      <h1 className="text-4xl font-bold">Yoink</h1>
      <form action={signOutAction}>
        <button
          type="submit"
          className="rounded-md bg-neutral-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
        >
          Log out
        </button>
      </form>
    </main>
  )
}
