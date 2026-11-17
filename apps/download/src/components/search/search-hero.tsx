'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'

import { SEARCH_PARAM_QUERY } from 'src/components/search/search-params'
import { HeroField } from 'src/components/ui/hero-field'

/**
 * How long the field waits for you to stop typing. The API is two upstream
 * services deep (Radarr and Sonarr, both queried per request), so a keystroke
 * is far too expensive to spend a round trip on.
 */
export const SEARCH_DEBOUNCE_MS = 300

export const SEARCH_HEADLINE = 'Search movies and shows'

export const SEARCH_PLACEHOLDER = 'Search a title…'

export const SEARCH_HINT = 'Title, year, cast or genre'
const SEARCH_HINT_TAIL = ' — across Radarr and Sonarr'

/** The field's and the form's accessible name. */
export const SEARCH_FIELD_LABEL = 'Search movies and shows'

export const SEARCH_FORM_LABEL = 'Search movies and shows'

/**
 * `/search`'s hero — the headline and the field it belongs to.
 *
 * This is the page's *only* search field: `NavSearch` returns `null` on
 * `/search` precisely so that it is, and two copies of one query would
 * otherwise sit on the same screen.
 *
 * ## The query lives in the URL
 *
 * Typing is local (the caret has to be instant); the URL is updated on a
 * {@link SEARCH_DEBOUNCE_MS} trailing debounce, and the server page reads the
 * URL. `replace` rather than `push` — a keystroke is not a navigation, and
 * `push` would make Back walk letter by letter out of a query. The Search
 * button and Enter flush the debounce.
 *
 * The other direction — the URL changing underneath the field, via Back, or
 * via `NavSearch` pushing a query at this route from somewhere else — is
 * handled by adjusting state *during render* against a sentinel of the
 * last-seen URL query, which React documents as the way to reset state when a
 * prop changes.
 *
 * ## Deviations from `search.pug`
 *
 * - The mockup marks the input `readonly` while loading. A field you cannot
 *   type into for 300ms after every keystroke is unusable, so it stays live.
 * - No URL branch. `NavSearch` classifies a pasted link and offers to download
 *   it; this field does not, because its hint scopes it to title, year, cast
 *   or genre, and a second, subtly different copy of that contract is one that
 *   will drift.
 */
export function SearchHero(): JSX.Element {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // A stable primitive, not the params object: `commit` below is a dependency
  // of the debounce effect, so anything in its closure that changes identity
  // every render would clear and restart the timer every render, and it would
  // never fire.
  const paramsString = searchParams.toString()
  const urlQuery = (searchParams.get(SEARCH_PARAM_QUERY) ?? '').trim()

  const [value, setValue] = useState(urlQuery)
  const [queryAtLastReset, setQueryAtLastReset] = useState(urlQuery)

  // Render-phase adjustment. See the note on the component.
  if (urlQuery !== queryAtLastReset) {
    setQueryAtLastReset(urlQuery)
    setValue(urlQuery)
  }

  /**
   * True from the first keystroke until the server's answer for that query is
   * on screen — the debounce window and the round trip both. The field knows
   * this without being told: what you typed is not yet what the URL says.
   */
  const pending = value.trim() !== urlQuery

  const commit = useCallback(
    (next: string) => {
      const nextParams = new URLSearchParams(paramsString)
      const trimmed = next.trim()

      if (trimmed) {
        nextParams.set(SEARCH_PARAM_QUERY, trimmed)
      } else {
        nextParams.delete(SEARCH_PARAM_QUERY)
      }

      const encoded = nextParams.toString()

      router.replace(encoded ? `${pathname}?${encoded}` : pathname, {
        scroll: false,
      })
    },
    [pathname, paramsString, router],
  )

  // The debounce. This is an effect that schedules a *navigation*, not one
  // that calls `setState` on a derived value — the cleanup is what coalesces a
  // burst of keystrokes into the single trailing call.
  useEffect(() => {
    if (!pending) {
      return
    }

    const timer = setTimeout(() => commit(value), SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [commit, pending, value])

  return (
    <HeroField
      autoFocus={!urlQuery}
      buttonLabel="Search"
      formLabel={SEARCH_FORM_LABEL}
      hint={
        <>
          {SEARCH_HINT}
          <span className="max-sm:hidden">{SEARCH_HINT_TAIL}</span>.
        </>
      }
      inputLabel={SEARCH_FIELD_LABEL}
      placeholder={SEARCH_PLACEHOLDER}
      title={SEARCH_HEADLINE}
      value={value}
      onSubmit={() => commit(value)}
      onValueChange={setValue}
    />
  )
}
