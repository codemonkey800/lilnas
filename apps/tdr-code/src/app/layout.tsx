import 'src/styles/globals.css'

import { cns } from '@lilnas/utils/cns'
import { Geist, Geist_Mono } from 'next/font/google'
import { type ReactNode } from 'react'

import { NavShell } from './components/nav-shell'
import { UiProviders } from './components/ui-providers'
import { ClickTracker } from './lib/click-tracker'
import { ErrorReporter } from './lib/error-reporter'
import { PageViewTracker } from './lib/page-view-tracker'
import { WebVitalsReporter } from './lib/web-vitals-reporter'
import { QueryProvider } from './providers'

export const metadata = {
  title: 'tdr-code',
}

// Geist for the UI, Geist Mono for the machine (docs/designs/foundations.md,
// "Fonts"). globals.css maps these variables onto --font-sans / --font-mono.
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html className={cns(sans.variable, mono.variable)} lang="en">
      <body className="bg-bg font-sans text-ink antialiased">
        <ErrorReporter />
        <PageViewTracker />
        <ClickTracker />
        <WebVitalsReporter />
        <QueryProvider>
          <UiProviders>
            <NavShell>{children}</NavShell>
          </UiProviders>
        </QueryProvider>
      </body>
    </html>
  )
}
