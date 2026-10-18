import 'src/tailwind.css'

import { cns } from '@lilnas/utils/cns'
import localFont from 'next/font/local'
import { ReactNode } from 'react'

import { Layout } from 'src/components/Layout'

// Self-hosted: fetching from Google Fonts at build time intermittently failed
// in CI. One variable file (latin subset) covers every weight we use.
const roboto = localFont({
  src: './fonts/roboto-latin-variable.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-roboto',
})

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <html className={cns('w-full h-full', roboto.variable)} lang="en">
      <body className="w-full h-full flex flex-auto flex-col">
        <Layout>{children}</Layout>
      </body>
    </html>
  )
}
