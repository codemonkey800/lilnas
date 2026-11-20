import type { JSX } from 'react'

export const metadata = { title: 'Not found · iCloud backup' }

export default function RootNotFound(): JSX.Element {
  return (
    <main className="mx-auto w-full max-w-[720px] px-6 py-10">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-ink-3">There is nothing at this address.</p>
    </main>
  )
}
