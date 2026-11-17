import 'src/styles/globals.css'

import { cns } from '@lilnas/utils/cns'
import { Geist, Geist_Mono } from 'next/font/google'
import { ReactNode } from 'react'

import { AppShell } from 'src/components/AppShell'
import Providers from 'src/components/Provider'

// Mapped to --font-sans / --font-mono with `@theme inline` in globals.css.
const sans = Geist({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-geist',
})

const mono = Geist_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-geist-mono',
})

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <html className={cns('h-full', sans.variable, mono.variable)} lang="en">
      <body className="flex min-h-full flex-col">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  )
}
