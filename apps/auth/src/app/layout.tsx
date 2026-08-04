import 'src/tailwind.css'

import { cns } from '@lilnas/utils/cns'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import type { ReactNode } from 'react'

// Self-hosted at build time (next/font downloads and serves the font file
// itself), not a runtime <link> to Google's CDN — strictly better for a
// self-hosted app: no third-party request, no layout shift while the CDN
// link resolves. `--fg`/design-tokens.css's own `.h1`/`.body-text`/etc.
// classes never set font-family themselves (they inherit from body), so
// applying `inter.className` here is the ONLY place Inter is wired in.
const inter = Inter({ subsets: ['latin'] })

// Reuses the same public/sad-pepe.svg the in-app <Brandmark> renders, so the
// browser tab icon matches the brand mark shown on every page instead of
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
    <html className="h-full" lang="en">
      <body
        className={cns(
          inter.className,
          'min-h-screen bg-bg text-fg antialiased',
        )}
      >
        {children}
      </body>
    </html>
  )
}
