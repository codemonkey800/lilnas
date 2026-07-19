import 'src/tailwind.css'

import { Roboto } from 'next/font/google'
import { ReactNode } from 'react'

import { Layout } from 'src/components/Layout'

const roboto = Roboto({
  weight: ['300', '400', '500', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-roboto',
})

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <html className={roboto.variable} lang="en">
      <body className="w-full h-full flex flex-auto flex-col">
        <Layout>{children}</Layout>
      </body>
    </html>
  )
}
