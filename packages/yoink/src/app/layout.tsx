import 'src/tailwind.css'

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Yoink',
  description: 'Yoink - lilnas service',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
