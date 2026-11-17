import 'src/tailwind.css'

import { ToastProvider } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import type { ReactNode } from 'react'

// Self-hosted at build time (next/font downloads and serves the font files
// itself), not a runtime <link> to Google's CDN — no third-party request and
// no layout shift. Each font exposes a CSS variable that src/tailwind.css
// maps onto `--font-sans` / `--font-mono` with `@theme inline`; that mapping
// is the ONLY place the families are wired in. The variable classes must sit
// on <html>: tailwind.css declares `--font-sans` at :root, and a custom
// property set on <body> is invisible to :root, so `var(--font-geist)` would
// resolve to nothing there and fall back to the system stack.
const sans = Geist({ subsets: ['latin'], variable: '--font-geist' })
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })

// Reuses the same public/sad-pepe.svg the system's pepe mark is drawn from, so
// the browser tab icon matches the mark shown on every page instead of
// falling back to Next.js's default icon.
export const metadata: Metadata = {
  title: 'lilnas Auth',
  description: 'Sign in to access lilnas.io',
  icons: {
    icon: '/sad-pepe.svg',
  },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html className={cns('h-full', sans.variable, mono.variable)} lang="en">
      <body className="min-h-screen bg-bg font-sans text-ink antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  )
}
