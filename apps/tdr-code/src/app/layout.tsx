import 'src/styles/globals.css'

import { ReactNode } from 'react'

export const metadata = {
  title: 'tdr-code',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
