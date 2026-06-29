import 'src/styles/globals.css'

import { type ReactNode } from 'react'

import { QueryProvider } from './providers'

export const metadata = {
  title: 'tdr-code',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  )
}
