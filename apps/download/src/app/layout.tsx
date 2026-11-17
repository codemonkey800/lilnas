import 'src/tailwind.css'

import { ToastProvider } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import { Geist, Geist_Mono } from 'next/font/google'
import { ReactNode } from 'react'

import { AppBar } from 'src/components/shell/app-bar'
import { NavSearch } from 'src/components/shell/nav-search'
import { getViewer } from 'src/lib/viewer'

// Per docs/designs/foundations.md: Geist for body and UI, Geist Mono for the
// machine voice, no display face. The variables are mapped onto `--font-sans`
// / `--font-mono` by the `@theme inline` block in src/tailwind.css.
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
 * The app shell. Every page renders inside the real app bar, with the viewer
 * resolved exactly once per request, and under the one `ToastProvider` the
 * `@lilnas/ui` toasts need.
 *
 * Async on purpose: `getViewer()` is the one identity resolution in the render,
 * and `React.cache()` means a page that also needs `isAdmin` reuses this result
 * rather than making a second call to the backend.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewer()

  return (
    <html
      className={cns('w-full h-full', sans.variable, mono.variable)}
      lang="en"
    >
      <body className="flex h-full w-full flex-auto flex-col font-sans">
        <ToastProvider>
          <AppBar navSearch={<NavSearch />} viewer={viewer} />
          {children}
        </ToastProvider>
      </body>
    </html>
  )
}
