import 'src/tailwind.css'

import { cns } from '@lilnas/utils/cns'
import { Roboto } from 'next/font/google'
import Link from 'next/link'
import { ReactNode } from 'react'

import Providers from 'src/components/Provider'

const roboto = Roboto({
  weight: ['300', '400', '500', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-roboto',
})

export const metadata = {
  title: 'Swole',
  description: 'Workout tracker',
}

// Layout (nav + page chrome) inlined here — the previous extraction to
// `src/components/Layout.tsx` had a single caller and offered no reuse (#44).
//
// Background and height: `bg-black` lives on `<body>` so any region the
// document covers (including overflow below the flex wrapper) is dark.
// Using `min-h-screen` instead of an `h-full` chain lets the wrapper grow
// with content — `h-full` capped each element at the viewport height and
// exposed the browser's default white below the dark wrapper on scroll.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <html className={cns(roboto.variable)} lang="en">
      <body className="bg-black text-white">
        <Providers>
          <div className="flex flex-col min-h-screen w-full">
            <nav className="sticky top-0 z-20 border-b border-neutral-800/80 bg-black/70 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-black/50 sm:px-6">
              <div className="mx-auto flex w-full max-w-3xl items-center justify-between">
                <a
                  className="text-2xl font-bold tracking-tight transition-colors hover:text-orange-500 active:text-orange-500"
                  href="/"
                >
                  Swole
                </a>
                <Link
                  href="/stats"
                  className="text-sm font-medium text-neutral-300 transition-colors hover:text-orange-500 active:text-orange-500"
                >
                  Stats
                </Link>
              </div>
            </nav>

            <main className="mx-auto w-full max-w-3xl flex-1 px-4 sm:px-6">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  )
}
