import 'src/tailwind.css'

import { cns } from '@lilnas/utils/cns'
import type { Metadata } from 'next'
import { JetBrains_Mono, Space_Grotesk } from 'next/font/google'
import type { ReactNode } from 'react'

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Yoink',
  description: 'Yoink - Media download manager',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className={cns(jetbrainsMono.variable, spaceGrotesk.variable)}>
        {children}
      </body>
    </html>
  )
}
