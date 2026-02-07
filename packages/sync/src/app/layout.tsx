import 'src/tailwind.css'

import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Sync',
  description: 'Sync application',
}

interface RootLayoutProps {
  children: ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg text-text antialiased">
        {children}
      </body>
    </html>
  )
}
