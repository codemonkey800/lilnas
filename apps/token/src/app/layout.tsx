import 'src/styles/globals.css'

import { ReactNode } from 'react'

import { AppShell } from 'src/components/AppShell'
import Providers from 'src/components/Provider'

export const metadata = {
  title: 'Token Manager',
  description: 'API Token Management for lilnas applications',
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  )
}
