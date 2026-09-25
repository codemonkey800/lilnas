'use client'

import { cns } from '@lilnas/utils/cns'
import { usePathname, useRouter } from 'next/navigation'
import type { FormEvent, JSX } from 'react'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from 'react'

import { startVideoDownload } from 'src/app/actions/start-video-download'
import { Button } from 'src/components/ui/button'
import { Icon } from 'src/components/ui/icon'
import { Input } from 'src/components/ui/input'
import { classifyQuery } from 'src/lib/url-classify'

/** Where a title query lands. `/search` owns results, filters and sort. */
export const SEARCH_ROUTE = '/search'

/**
 * The one route that does **not** get this field.
 *
 * `search.pug:239` draws its own app bar with the nav search omitted, because
 * that page's hero already *is* the search and two copies of the same field on
 * one screen is two places to type the same query. The shell mounts `AppBar`
 * globally in `layout.tsx` and there is no route-level opt-out, so the opt-out
 * lives here — the field is the thing that knows it has a duplicate, and
 * `usePathname()` is the only way for a slot's occupant to ask where it is.
 */
const OMITTED_ON: readonly string[] = [SEARCH_ROUTE]

/** `mock.pug`'s `navsearch` default, with the ellipsis every page passes. */
export const NAV_SEARCH_PLACEHOLDER = 'Search or paste a link…'

/**
 * The field's accessible name. Separate from the placeholder because a
 * placeholder is not a label — it disappears the moment there is a value.
 */
const NAV_SEARCH_LABEL = 'Search or paste a link'

/**
 * The collapsed mobile trigger's name.
 *
 * `mock.pug` labels it plain "Search", but in the real app it sits in the same
 * accessibility tree as the field's own Search button, and two controls named
 * "Search" that do entirely different things is a worse outcome than a one-word
 * deviation from the mixin. "Open search" also pairs with "Close search", which
 * the mockup already spells out.
 */
const OPEN_SEARCH_LABEL = 'Open search'

/**
 * The pill, straight out of `mock.pug`'s `navsearch`.
 *
 * ⚠️ `h-8`, not the `h-11` `nav-search.html` renders. That page passes
 * `tall: true` to every one of its examples while every *other* page passes
 * nothing and gets 32px; `designs/README.md` flags the pair as an unreconciled
 * inconsistency. 32px is the size the rest of the bar is built around — a 44px
 * field would push the mobile bar from 53px to 65px — so 32px it is, on every
 * screen.
 *
 * The focus treatment is `focus-within` on the pill rather than `focus` on the
 * input, because the input stops being the only focusable thing inside it the
 * moment the action button appears.
 */
const NAV_SEARCH_PILL = cns(
  'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-bg-sunk px-3',
  'transition-[border-color,box-shadow] duration-200 ease-uv',
  'focus-within:border-uv focus-within:shadow-[0_0_0_3px_var(--color-uv-ghost)]',
)

/**
 * The bare input inside the pill. `Input`'s own chrome — its 38px height, its
 * border, its fill, its focus ring — all belong to the pill here, so each one
 * is switched off rather than left to fight the wrapper.
 *
 * Deliberately not `Input`'s `icon` prop, even though that prop exists for this
 * field: `INPUT_ICON` hard-codes `text-ink-4`, and the entire point of the icon
 * here is that it *changes* — glyph and colour both — the instant the text
 * classifies as a link. A stateful icon has to be rendered by whatever holds
 * the state, and the action button has to be a flex sibling of the input rather
 * than an absolutely-positioned overlay so that the input can give up exactly
 * as much width as the button's label needs.
 */
const NAV_SEARCH_INPUT = cns(
  'h-full w-auto min-w-0 flex-1 truncate rounded-none border-0 bg-transparent p-0',
  'text-[13px] text-ink',
  'focus:border-transparent focus:shadow-none',
)

/** `navsearchGo` — a 24px pill inside the 32px one. */
const NAV_SEARCH_GO = 'h-6 shrink-0 rounded-full px-[14px] text-[11.5px]'

/** Both 30px ghost icon buttons. Mobile only; the bar has room on desktop. */
const NAV_SEARCH_ICON_BUTTON = 'h-[30px] w-[30px] shrink-0 p-0 sm:hidden'

/**
 * Desktop: the field is the elastic middle of the bar, inline, always.
 * Mobile: it is not in the bar at all until tapped — the collapsed trigger is.
 */
const NAV_SEARCH_FORM = 'relative min-w-0 items-center sm:flex sm:flex-1'

/**
 * Expanded, on mobile, the field takes over the whole bar (spec
 * §"Entry-point model"; `nav-search.pug:90-98`).
 *
 * ⚠️ This re-states `AppBar`'s own mobile bar recipe — `py-2.5 pr-[14px]
 * pl-4`, `border-b border-line-soft bg-bg-sunk` — because it has to *cover*
 * that bar, and a child of the nav-search slot cannot reach up to hide the
 * doorplate and the account link. Rebuilding the recipe rather than hard-coding
 * a height is what keeps the overlay exactly as tall as the bar underneath it
 * (10 + 32 + 10 + a 1px border = 53px) without either file naming the number.
 *
 * `fixed` rather than `absolute`: the slot is not a positioning context, and
 * `app-bar.tsx` is closed to this task. The shell's `<body>` is
 * `h-full flex flex-col` with the bar `shrink-0` at the top, so the viewport
 * origin and the bar's origin are the same point.
 *
 * The `sm:` half undoes all of it. Crossing 640px while expanded has to land on
 * the inline desktop field, and settling that in CSS rather than with a
 * `matchMedia` listener means it is already true during SSR and on the first
 * paint, not one effect later.
 */
const NAV_SEARCH_FORM_EXPANDED = cns(
  'fixed inset-x-0 top-0 z-30 flex gap-2.5',
  'border-b border-line-soft bg-bg-sunk py-2.5 pr-[14px] pl-4',
  'sm:relative sm:z-auto sm:gap-0 sm:border-b-0 sm:bg-transparent sm:p-0',
)

/**
 * `search.pug:105`'s error idiom — alert glyph, mono, `text-bad` — lifted onto
 * the bar as a popover, because a 32px field in a nav bar has nowhere to put a
 * message inline.
 */
const NAV_SEARCH_ERROR = cns(
  'absolute top-full left-4 z-30 mt-1.5 flex max-w-[320px] items-center gap-[5px]',
  'rounded-md border border-line bg-surface px-2.5 py-[7px] shadow-lift',
  'font-mono text-[11px] text-bad',
  'sm:left-0',
)

/**
 * Move focus to an element by id.
 *
 * `Button` and `Input` take `ComponentPropsWithoutRef`, so neither accepts a
 * `ref` — and widening those prop types is a change to a shared contract three
 * other tasks are building against, not something this field should do on its
 * way past. Ids from one `useId()` are stable, unique per instance, and already
 * needed here for `aria-describedby`.
 */
function focusById(id: string): void {
  const element = document.getElementById(id)

  if (element instanceof HTMLElement) {
    element.focus()
  }
}

/**
 * The single entry point for both of this app's jobs — paste a video link, or
 * search for a movie or show — in the nav bar of every page.
 *
 * Classification is instant and client-side (`src/lib/url-classify.ts`), so
 * there is no dropdown, no preview card and no resolving state: either a
 * compact Download button is in the pill, or a compact Search one is, or
 * neither. Enter and the button are the same code path, which is why both go
 * through the form's `submit` rather than through the button's `onClick`.
 *
 * ⚠️ The action button takes `aria-disabled` while a create is in flight, not
 * `disabled`, and the guard that actually blocks a double-submit lives in
 * `onSubmit`. `aria-disabled` cannot stop a `type="submit"` button natively —
 * but it does not have to here, because there are exactly two ways to submit
 * this form (the button, and Enter in the input), both raise the same `submit`
 * event, and the form has no `action` attribute, so nothing at all happens
 * outside that one handler. What that buys is the button keeping its focus: a
 * real `disabled` attribute drops it out of the focus order mid-press, and a
 * failed create would then leave the user on `<body>`, Tabbing back from the
 * top of the document to try again.
 */
export function NavSearch(): JSX.Element | null {
  const pathname = usePathname()
  const router = useRouter()

  const [value, setValue] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const baseId = useId()
  const inputId = `${baseId}-input`
  const triggerId = `${baseId}-trigger`
  const errorId = `${baseId}-error`

  /** The one in-flight focus frame, so a newer intent can cancel an older one. */
  const focusFrameRef = useRef(0)

  /**
   * Focus an element by id on the next frame, cancelling whatever frame was
   * already queued.
   *
   * ⚠️ The deferral and the cancellation are both load-bearing, for different
   * reasons.
   *
   * **Deferred**, because each of this field's two focus targets is
   * `display: none` at the instant its own handler runs. The input is hidden
   * until the expanding render commits; the trigger is hidden until the
   * *collapsing* one does, since it wears `hidden` for exactly as long as the
   * overlay is up. A `display: none` element cannot take focus, so a
   * synchronous `.focus()` on either is a silent no-op in a browser and leaves
   * the user on `<body>`. jsdom models neither `display` nor that rule, which
   * is why only the half of this that is a *race* was ever visible in a test.
   *
   * **Cancelled**, because otherwise opening and closing within one frame
   * leaves both frames queued and the stale one wins: the trigger takes focus,
   * and then the open frame drags it onto the hidden input.
   */
  const focusNextFrame = useCallback((id: string) => {
    window.cancelAnimationFrame(focusFrameRef.current)
    focusFrameRef.current = window.requestAnimationFrame(() => focusById(id))
  }, [])

  // A frame that outlives the component would focus a detached node.
  useEffect(() => () => window.cancelAnimationFrame(focusFrameRef.current), [])

  // A route change is the other way out of the expanded state, alongside the
  // close button — "closing it, or a redirect firing, hands the bar back".
  // Both branches end in a navigation, and this component lives in the layout,
  // so neither one unmounts it.
  //
  // Adjusted during render rather than in an effect. React documents this as
  // the way to reset state when a value changes ("You Might Not Need an
  // Effect"): the setters below bail out of the render that is already in
  // flight and re-run this function immediately, so the bar never paints a
  // frame of the old route's expanded field. An effect would paint that frame
  // first and then correct it, which is also why `react-hooks/set-state-in-
  // effect` rejects it.
  const [routeAtLastReset, setRouteAtLastReset] = useState(pathname)

  if (pathname !== routeAtLastReset) {
    setRouteAtLastReset(pathname)
    setExpanded(false)
    setValue('')
    setError(null)
  }

  const classification = classifyQuery(value)
  const ready = classification.kind !== 'idle'

  const openSearch = useCallback(() => {
    setExpanded(true)
    // The bar the user just tapped is gone; without this the caret is nowhere
    // and the expansion reads as decoration rather than an invitation.
    focusNextFrame(inputId)
  }, [focusNextFrame, inputId])

  const closeSearch = useCallback(() => {
    setExpanded(false)
    setError(null)
    // Closing deliberately is the one case that owes the user their focus back:
    // the trigger is where they were standing before they opened it.
    focusNextFrame(triggerId)
  }, [focusNextFrame, triggerId])

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()

      // The double-submit guard. See the note on the component: this, and not
      // the button's attribute, is what makes a second press a no-op.
      if (pending) {
        return
      }

      // Re-classified from the current value rather than closed over, so the
      // handler can never act on a stale reading of the field.
      const current = classifyQuery(value)

      if (current.kind === 'idle') {
        return
      }

      setError(null)

      if (current.kind === 'search') {
        router.push(`${SEARCH_ROUTE}?q=${encodeURIComponent(current.query)}`)
        return
      }

      startTransition(async () => {
        // The action's return type is `… | undefined` for a reason: on success
        // it redirects and never returns, and Next resolves the call with
        // `undefined`. Getting a value back at all means the create failed.
        const result = await startVideoDownload(current.url)

        if (result) {
          setError(result.error)
        }
      })
    },
    [pending, router, value],
  )

  if (OMITTED_ON.includes(pathname)) {
    return null
  }

  return (
    <>
      <Button
        aria-expanded={expanded}
        aria-label={OPEN_SEARCH_LABEL}
        className={cns(NAV_SEARCH_ICON_BUTTON, expanded && 'hidden')}
        icon="search"
        id={triggerId}
        onClick={openSearch}
        variant="ghost"
      />
      <form
        aria-label={NAV_SEARCH_LABEL}
        className={cns(
          NAV_SEARCH_FORM,
          expanded ? NAV_SEARCH_FORM_EXPANDED : 'hidden',
        )}
        onKeyDown={event => {
          if (event.key === 'Escape' && expanded) {
            closeSearch()
          }
        }}
        onSubmit={onSubmit}
        role="search"
      >
        {expanded ? (
          <Button
            aria-label="Close search"
            className={NAV_SEARCH_ICON_BUTTON}
            icon="x"
            onClick={closeSearch}
            variant="ghost"
          />
        ) : null}
        <div
          className={cns(
            NAV_SEARCH_PILL,
            ready ? 'max-w-[360px]' : 'max-w-[320px]',
          )}
        >
          <Icon
            className={cns(
              'h-[14px] w-[14px] shrink-0',
              ready ? 'text-uv-hi' : 'text-ink-4',
            )}
            name={classification.kind === 'url' ? 'download' : 'search'}
          />
          <Input
            aria-describedby={error ? errorId : undefined}
            aria-label={NAV_SEARCH_LABEL}
            autoComplete="off"
            className={cns(NAV_SEARCH_INPUT, ready && 'pr-5')}
            enterKeyHint="search"
            id={inputId}
            name="q"
            onChange={event => {
              setValue(event.target.value)
              setError(null)
            }}
            placeholder={NAV_SEARCH_PLACEHOLDER}
            value={value}
          />
          {classification.kind === 'idle' ? null : (
            <Button
              aria-disabled={pending}
              className={NAV_SEARCH_GO}
              type="submit"
              variant="uv"
            >
              {classification.kind === 'url' ? 'Download' : 'Search'}
            </Button>
          )}
        </div>
        {error ? (
          <p className={NAV_SEARCH_ERROR} id={errorId} role="alert">
            <Icon className="h-[11px] w-[11px] shrink-0" name="alert" />
            {error}
          </p>
        ) : null}
      </form>
    </>
  )
}
