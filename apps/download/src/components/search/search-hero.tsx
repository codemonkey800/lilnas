'use client'

import { cns } from '@lilnas/utils/cns'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { FormEvent, JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'

import { SEARCH_PARAM_QUERY } from 'src/components/search/search-params'
import { Spinner } from 'src/components/ui/feedback'
import { Icon } from 'src/components/ui/icon'
import { Input } from 'src/components/ui/input'

/**
 * How long the field waits for you to stop typing. The API is two upstream
 * services deep (Radarr and Sonarr, both queried per request), so a keystroke
 * is far too expensive to spend a round trip on.
 */
export const SEARCH_DEBOUNCE_MS = 300

/** `search.pug:22`. */
export const SEARCH_HEADLINE = 'Search movies & shows.'

/** `search.mjs`'s `HINT_MOBILE`, plus the tail `HINT` adds once there is room. */
const SEARCH_HINT = 'title · year · cast · genre'
const SEARCH_HINT_TAIL = ' — across Radarr and Sonarr'

/**
 * The field's accessible name. The mockup's hero has no visible label — the
 * headline above it is the label, semantically, but it is a `<p>` and a
 * headline is not a form label, so the name is stated here instead.
 */
export const SEARCH_FIELD_LABEL = 'Search movies and shows'

export const SEARCH_FORM_LABEL = 'Search movies and shows'

/**
 * `search.pug:21`. Two mutually exclusive type scales rather than a base plus
 * an override, because two font-size utilities on one element are resolved by
 * Tailwind's output order — `sm:` is a different variant, so both survive
 * `cns` and the browser picks by breakpoint, which is the intent.
 */
const SEARCH_HEADLINE_CLASSES = cns(
  'font-sans font-[780] tracking-[-0.025em] text-ink',
  'mb-[18px] text-[32px]/[1.03]',
  'sm:mb-[22px] sm:text-[54px]/[1.03]',
)

/**
 * `search.pug:25`. An underline rather than a box: at this size a box would
 * read as a form. `focus-within` rather than `focus`, because the accent has
 * to survive on the rule while the caret is in the field.
 */
const SEARCH_RULE_CLASSES = cns(
  'flex items-center gap-4 border-b-2 border-uv pb-4',
  'transition-[border-color] duration-200 ease-uv focus-within:border-uv',
)

/**
 * `Input`'s whole chrome belongs to the rule above, not to the input: the
 * 38px box, the border, the fill and the focus ring are all switched off here
 * rather than left to fight the wrapper. Same approach `nav-search.tsx` takes
 * with the nav bar's pill.
 */
const SEARCH_INPUT_CLASSES = cns(
  'h-auto w-auto min-w-0 flex-1 rounded-none border-0 bg-transparent p-0',
  'text-[18px] text-ink sm:text-[25px]',
  'focus:border-transparent focus:shadow-none',
)

const SEARCH_ICON_CLASSES =
  'h-4 w-4 shrink-0 text-ink-4 sm:h-[22px] sm:w-[22px]'

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
 * `push` would make Back walk letter by letter out of a query.
 *
 * The other direction — the URL changing underneath the field, via Back, or
 * via `NavSearch` pushing a query at this route from somewhere else — is
 * handled by adjusting state *during render* against a sentinel of the
 * last-seen URL query. React documents this as the way to reset state when a
 * prop changes; the alternative, a `useEffect` calling `setValue`, is rejected
 * outright by `react-hooks/set-state-in-effect` and would paint one frame of
 * the old query before correcting itself.
 *
 * ## Deviations from `search.pug`
 *
 * - The mockup draws a `border-bad` hero for its "No matches" frame. No
 *   matches is a plain outcome here, not an error — the query was valid and
 *   the answer was zero — so the rule stays accent-coloured and the note below
 *   the toolbar carries the message. Turning the field red would say the user
 *   did something wrong.
 * - The mockup marks the input `readonly` while loading. A field you cannot
 *   type into for 300ms after every keystroke is unusable; the spinner alone
 *   carries the in-flight state.
 * - No URL branch. `NavSearch` classifies a pasted link and offers to download
 *   it; this field does not, because `search.pug`'s hint scopes it to
 *   `title · year · cast · genre` and a second, subtly different copy of that
 *   contract is one that will drift. (See the note in the task report: this
 *   does leave `/search` with no paste-a-link affordance at all, since the nav
 *   field is suppressed here.)
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

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      // No `action`, and this always runs: pressing Enter flushes the pending
      // debounce instead of waiting it out. There is no submit button — a
      // single-field form submits implicitly on Enter — so there is no control
      // here to reason about `disabled` versus `aria-disabled` for.
      event.preventDefault()
      commit(value)
    },
    [commit, value],
  )

  return (
    <div>
      <p className={SEARCH_HEADLINE_CLASSES}>{SEARCH_HEADLINE}</p>
      <form aria-label={SEARCH_FORM_LABEL} onSubmit={onSubmit} role="search">
        <div className={SEARCH_RULE_CLASSES}>
          {pending ? (
            <Spinner className="h-4 w-4 sm:h-[22px] sm:w-[22px]" />
          ) : (
            <Icon className={SEARCH_ICON_CLASSES} name="search" />
          )}
          <Input
            aria-label={SEARCH_FIELD_LABEL}
            autoComplete="off"
            autoFocus={!urlQuery}
            className={SEARCH_INPUT_CLASSES}
            enterKeyHint="search"
            mono
            name={SEARCH_PARAM_QUERY}
            onChange={event => setValue(event.target.value)}
            placeholder={SEARCH_HINT}
            value={value}
          />
        </div>
      </form>
      <p className="mt-2.5 font-mono text-mono-sm text-ink-3">
        {SEARCH_HINT}
        <span className="hidden sm:inline">{SEARCH_HINT_TAIL}</span>
      </p>
    </div>
  )
}
