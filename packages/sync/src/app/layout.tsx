import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import 'src/tailwind.css'

export const metadata: Metadata = {
  title: 'Sync',
  description: 'Sync application',
}

interface RootLayoutProps {
  children: ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
