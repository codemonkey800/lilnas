import 'src/styles/globals.css'

import { type ReactNode } from 'react'

import { NavShell } from './components/nav-shell'
import { ClickTracker } from './lib/click-tracker'
import { ErrorReporter } from './lib/error-reporter'
import { PageViewTracker } from './lib/page-view-tracker'
import { QueryProvider } from './providers'

export const metadata = {
  title: 'tdr-code',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-white antialiased">
        <ErrorReporter />
        <PageViewTracker />
        <ClickTracker />
        <QueryProvider>
          <NavShell>{children}</NavShell>
        </QueryProvider>
      </body>
    </html>
  )
}
