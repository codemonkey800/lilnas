import 'src/tailwind.css'

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Apps',
  description: 'Application homepage for lilnas.io',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html className="w-full h-full flex flex-col flex-auto" lang="en">
      <body className="flex flex-col flex-auto">{children}</body>
    </html>
  )
}
