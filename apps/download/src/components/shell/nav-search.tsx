'use client'

import { Button, Icon, Search } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import { usePathname } from 'next/navigation'
import type { JSX } from 'react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

import {
  SEARCH_ROUTE,
  useSearchOrDownload,
} from 'src/components/shell/use-search-or-download'

export { SEARCH_ROUTE }

/**
 * The routes that do **not** get this field: each draws its own hero field
 * (`home.pug`, `search.pug` draw their bars with the nav search omitted), and
 * two copies of the same field on one screen is two places to type one query.
 * The shell mounts `AppBar` globally in `layout.tsx` with no route-level
 * opt-out, so the field is what knows it has a duplicate.
 */
const OMITTED_ON: readonly string[] = [SEARCH_ROUTE, '/']

export const NAV_SEARCH_PLACEHOLDER = 'Search or paste a link…'

/** The collapsed phone trigger's name; distinct from the field's own button. */
const OPEN_SEARCH_LABEL = 'Open search'

/**
 * Inline from `sm` up, hidden below it until the trigger opens it — then it
 * covers the whole bar (a child of the bar's end slot cannot hide the
 * doorplate any other way), and the `sm:` half undoes all of it so crossing
 * 640px while open lands on the inline field with no `matchMedia` listener.
 */
const FIELD_COLLAPSED = 'hidden sm:block sm:w-72'
const FIELD_EXPANDED = cns(
  'fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-2',
  'border-b border-line bg-surface px-4',
  'sm:relative sm:z-auto sm:block sm:h-auto sm:w-72 sm:border-b-0 sm:bg-transparent sm:p-0',
)

/** A failed create, on the bar as a popover: a 36px field has no room inline. */
const FIELD_ERROR = cns(
  'absolute top-full left-4 z-30 mt-1.5 flex max-w-[320px] items-center gap-1.5',
  'rounded-md border border-line bg-surface px-2.5 py-2 shadow-lift',
  'text-cap text-bad sm:right-0 sm:left-auto',
)

function focusById(id: string): void {
  const element = document.getElementById(id)
  const target = element?.matches('input')
    ? element
    : element?.querySelector('input')

  if (element instanceof HTMLElement) {
    ;(target ?? element).focus()
  }
}

/**
 * The nav bar's field, on every page but the two with a hero of their own.
 *
 * `Search` from `@lilnas/ui`, labelled by what its button will do: **Download**
 * for a pasted link, **Search** for a title (icon-only below `sm`). The field is
 * rendered once and CSS repositions it, so the accessible tree never holds two.
 */
export function NavSearch(): JSX.Element | null {
  const pathname = usePathname()
  const field = useSearchOrDownload()
  const { classification, reset, clearError } = field

  const [expanded, setExpanded] = useState(false)

  const baseId = useId()
  const triggerId = `${baseId}-trigger`
  const wrapperId = `${baseId}-field`

  /** The one in-flight focus frame, so a newer intent can cancel an older one. */
  const focusFrameRef = useRef(0)

  // Both focus targets are `display: none` at the instant their own handler
  // runs (the field until the expanding render commits, the trigger until the
  // collapsing one does), and a hidden element cannot take focus — so the move
  // waits a frame, and a newer intent cancels an older frame so a quick
  // open-then-close cannot drag focus onto the hidden field afterwards.
  const focusNextFrame = useCallback((id: string) => {
    window.cancelAnimationFrame(focusFrameRef.current)
    focusFrameRef.current = window.requestAnimationFrame(() => focusById(id))
  }, [])

  useEffect(() => () => window.cancelAnimationFrame(focusFrameRef.current), [])

  // A route change hands the bar back: adjusted during render, not in an
  // effect, so the bar never paints a frame of the old route's open field.
  const [routeAtLastReset, setRouteAtLastReset] = useState(pathname)

  if (pathname !== routeAtLastReset) {
    setRouteAtLastReset(pathname)
    setExpanded(false)
    reset()
  }

  const openSearch = useCallback(() => {
    setExpanded(true)
    focusNextFrame(wrapperId)
  }, [focusNextFrame, wrapperId])

  const closeSearch = useCallback(() => {
    setExpanded(false)
    clearError()
    focusNextFrame(triggerId)
  }, [clearError, focusNextFrame, triggerId])

  if (OMITTED_ON.includes(pathname)) {
    return null
  }

  const download = classification.kind === 'url'

  return (
    <>
      <Button
        aria-expanded={expanded}
        aria-label={OPEN_SEARCH_LABEL}
        className={cns('sm:hidden', expanded && 'hidden')}
        icon="search"
        id={triggerId}
        onClick={openSearch}
        variant="ghost"
      />
      <div
        className={cns('relative', expanded ? FIELD_EXPANDED : FIELD_COLLAPSED)}
        id={wrapperId}
        onKeyDown={event => {
          if (event.key === 'Escape' && expanded) {
            closeSearch()
          }
        }}
      >
        {expanded ? (
          <Button
            aria-label="Close search"
            className="sm:hidden"
            icon="x"
            onClick={closeSearch}
            variant="ghost"
          />
        ) : null}
        <Search
          buttonLabel={download ? 'Download' : 'Search'}
          className="min-w-0 flex-1"
          pending={field.pending}
          placeholder={NAV_SEARCH_PLACEHOLDER}
          value={field.value}
          onSubmit={field.submit}
          onValueChange={value => {
            field.setValue(value)
            clearError()
          }}
        />
        {field.error ? (
          <p className={FIELD_ERROR} role="alert">
            <Icon className="size-3 shrink-0" name="alert" />
            {field.error}
          </p>
        ) : null}
      </div>
    </>
  )
}
