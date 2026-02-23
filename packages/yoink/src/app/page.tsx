import { signOutAction } from 'src/app/login/actions'

export default function Home() {
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
