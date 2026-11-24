import 'src/styles/globals.css'

import { cns } from '@lilnas/utils/cns'
import localFont from 'next/font/local'
import { ReactNode } from 'react'

import { AppShell } from 'src/components/AppShell'
import Providers from 'src/components/Provider'

// Self-hosted (latin subset of the Geist variable fonts, SIL OFL 1.1) instead of
// `next/font/google`: the Google loader fetches fonts.gstatic.com at build time,
// and when that fetch fails on the CI runner Turbopack aborts the whole build
// ("next/font/google queries have exactly one entry"), so the image is never
// built or deployed. Mapped to --font-sans / --font-mono with `@theme inline`
// in globals.css.
const sans = localFont({
  src: './fonts/Geist-Variable.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-geist',
})

const mono = localFont({
  src: './fonts/GeistMono-Variable.woff2',
  weight: '100 900',
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
