import 'src/tailwind.css'

import { AppBar, ToastProvider } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'

export const metadata: Metadata = {
  title: 'Apps',
  description: 'Application homepage for lilnas.io',
}

// Mapped to --font-sans / --font-mono with `@theme inline` in tailwind.css.
const sans = Geist({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-geist',
})

const mono = Geist_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-geist-mono',
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html className={cns('h-full', sans.variable, mono.variable)} lang="en">
      <body className="flex min-h-full flex-col">
        <ToastProvider>
          <AppBar />
          <main className="mx-auto w-full max-w-[1040px] flex-auto px-4 py-6 md:px-8 md:py-10">
            {children}
          </main>
        </ToastProvider>
      </body>
    </html>
  )
}
