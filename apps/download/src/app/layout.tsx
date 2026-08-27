import 'src/tailwind.css'

import { cns } from '@lilnas/utils/cns'
import { Figtree, IBM_Plex_Mono } from 'next/font/google'
import { ReactNode } from 'react'

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

export default function AppLayout({ children }: { children: ReactNode }) {
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
        {children}
      </body>
    </html>
  )
}
