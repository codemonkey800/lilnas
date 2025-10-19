import 'src/styles/globals.css'

import { cns } from '@lilnas/utils/cns'
import { GeistSans } from 'geist/font/sans'
import { ReactNode } from 'react'

import { Layout } from 'src/components/Layout'
import Providers from 'src/components/Provider'

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <html className={cns('w-full h-full', GeistSans.className)} lang="en">
      <body className="w-full h-full flex flex-auto flex-col">
        <Providers>
          <Layout>{children}</Layout>
        </Providers>
      </body>
    </html>
  )
}
