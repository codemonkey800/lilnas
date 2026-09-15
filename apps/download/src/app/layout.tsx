import 'src/tailwind.css'

import { cns } from '@lilnas/utils/cns'
import { Figtree, IBM_Plex_Mono } from 'next/font/google'
import { ReactNode } from 'react'

import { AppBar } from 'src/components/shell/app-bar'
import { NavSearch } from 'src/components/shell/nav-search'
import { IconSprite } from 'src/components/ui/sprite'
import { getViewer } from 'src/lib/viewer'

// Per docs/designs/foundations.md, `download` loads Figtree (body/UI) and
// IBM Plex Mono (machine) and deliberately skips the Bricolage Grotesque
// display face. The variables match --font-sans / --font-mono in the
// Ultraviolet token layer, which the frontend rewrite layers on top.
const figtree = Figtree({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
})

const ibmPlexMono = IBM_Plex_Mono({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
})

/**
 * The app shell. Every page renders inside the real app bar, with the viewer
 * resolved exactly once per request.
 *
 * Ordering inside `<body>` is load-bearing: `<IconSprite />` comes first,
 * because `AppBar`'s doorplate paints its pepe badge with a
 * `<use href="#pepe">` into the sprite and renders a blank badge without it.
 * It is rendered here and nowhere else — a second copy would duplicate every
 * `<symbol id>` in the document and make the `#i-*` references ambiguous.
 *
 * Async on purpose: `getViewer()` is the one identity resolution in the render,
 * and `React.cache()` means a page that also needs `isAdmin` reuses this result
 * rather than making a second call to the backend.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewer()

  return (
    <html
      className={cns('w-full h-full', figtree.variable, ibmPlexMono.variable)}
      lang="en"
    >
      <body
        className={cns(
          'w-full h-full flex flex-auto flex-col',
          'font-[family-name:var(--font-sans)]',
        )}
      >
        <IconSprite />
        <AppBar navSearch={<NavSearch />} viewer={viewer} />
        {children}
      </body>
    </html>
  )
}
