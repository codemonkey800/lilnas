import 'src/tailwind.css'

import { cns } from '@lilnas/utils/cns'
import { Roboto } from 'next/font/google'
import { ReactNode } from 'react'

import { Layout } from 'src/components/Layout'
import Providers from 'src/components/Provider'

const roboto = Roboto({
  weight: ['300', '400', '500', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-roboto',
})

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <html className={cns('w-full h-full', roboto.variable)} lang="en">
      <body className="w-full h-full flex flex-auto flex-col">
        <Providers>
          <Layout>{children}</Layout>
        </Providers>
      </body>
    </html>
  )
}
