import 'src/tailwind.css'

import { AppBar, Density, ToastProvider } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import { Geist, Geist_Mono } from 'next/font/google'
import { ReactNode } from 'react'

export const metadata = { title: 'dev.lilnas.io' }

// Geist for the UI, Geist Mono for the machine (docs/designs/foundations.md,
// "Fonts"). tailwind.css maps these variables onto --font-sans / --font-mono.
const sans = Geist({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-geist',
})

const mono = Geist_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-geist-mono',
})

/**
 * The root layout: fonts, the page background and the app chrome (toasts,
 * compact density and the app bar). The dashboard is a compact app, so
 * everything, the bar included, sits in `Density mode="compact"`. It has no
 * navigation and no signed-in user, so the bar carries the doorplate only.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      className={cns('h-full w-full', sans.variable, mono.variable)}
      lang="en"
    >
      <body className="flex h-full w-full flex-auto flex-col bg-bg font-sans text-ink">
        <ToastProvider>
          <Density className="flex flex-auto flex-col" mode="compact">
            <AppBar app="dev" />
            {children}
          </Density>
        </ToastProvider>
      </body>
    </html>
  )
}
