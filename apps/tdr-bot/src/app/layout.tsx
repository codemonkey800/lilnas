import 'src/styles/globals.css'

import { ReactNode } from 'react'

import { AppShell } from 'src/components/AppShell'
import Providers from 'src/components/Provider'

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
