import 'src/styles/globals.css'

import { type ReactNode } from 'react'

import { NavShell } from './components/nav-shell'
import { QueryProvider } from './providers'

export const metadata = {
  title: 'tdr-code',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>
          <NavShell>{children}</NavShell>
        </QueryProvider>
      </body>
    </html>
  )
}
