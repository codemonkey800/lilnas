import 'src/tailwind.css'

import { cns } from '@lilnas/utils/cns'
import { Figtree, IBM_Plex_Mono } from 'next/font/google'
import { ReactNode } from 'react'

import { AppBar } from 'src/components/shell/app-bar'
import { IconSprite } from 'src/components/ui/sprite'

export const metadata = { title: 'dev.lilnas.io' }

// Per docs/designs/foundations.md the dashboard loads Figtree (body/UI) and
// IBM Plex Mono (machine) and, like `download`, skips the Bricolage Grotesque
// display face. The variables match --font-sans / --font-mono in tailwind.css.
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
 * The app shell. `<IconSprite />` comes first inside `<body>`: the doorplate
 * paints its pepe badge with a `<use href="#pepe">` into the sprite, and it is
 * rendered here and nowhere else so every `<symbol id>` stays unique.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      className={cns('h-full w-full', figtree.variable, ibmPlexMono.variable)}
      lang="en"
    >
      <body
        className={cns(
          'flex h-full w-full flex-auto flex-col bg-bg text-ink',
          'font-[family-name:var(--font-sans)]',
        )}
      >
        <IconSprite />
        <AppBar />
        {children}
      </body>
    </html>
  )
}
