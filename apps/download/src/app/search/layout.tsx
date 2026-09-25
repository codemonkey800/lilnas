import type { JSX, ReactNode } from 'react'

import { SearchHero } from 'src/components/search/search-hero'

/**
 * `/search`'s own shell.
 *
 * ⚠️ The hero is here rather than in `page.tsx` on purpose, and it is the one
 * structural decision on this route worth stating outright.
 *
 * `loading.tsx` replaces everything below it while a navigation is in flight,
 * and on this page *every keystroke is a navigation* — the field debounces
 * into the URL, and the server reads the URL. A hero inside `page.tsx` would
 * therefore be unmounted and rebuilt 300ms after each letter, taking the caret
 * and the selection with it and making the field impossible to type into. A
 * layout sits above the loading boundary, so the field is mounted exactly once
 * per visit no matter how many queries pass through it.
 *
 * The padding is `mock.pug`'s `appBody` and the 1080px measure is the wrapper
 * `search.pug`'s desktop frames put their content in.
 */
export default function SearchLayout({
  children,
}: {
  children: ReactNode
}): JSX.Element {
  return (
    <main className="flex-auto px-6 pt-[18px] pb-[30px] sm:px-8 sm:pt-[30px] sm:pb-11">
      <div className="mx-auto max-w-[1080px]">
        <SearchHero />
        {children}
      </div>
    </main>
  )
}
