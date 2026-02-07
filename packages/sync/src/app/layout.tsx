import 'src/tailwind.css'

import type { Metadata } from 'next'
import { SessionProvider } from 'next-auth/react'
import type { ReactNode } from 'react'

import { auth } from 'src/auth'

export const metadata: Metadata = {
  title: 'Sync',
  description: 'Sync application',
}

interface RootLayoutProps {
  children: ReactNode
}

export default async function RootLayout({ children }: RootLayoutProps) {
  const session = await auth()

  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg text-text antialiased">
        <SessionProvider session={session}>{children}</SessionProvider>
      </body>
    </html>
  )
}
