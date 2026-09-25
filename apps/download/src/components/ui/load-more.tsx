'use client'

import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

import { Button } from 'src/components/ui/button'
import { Spinner } from 'src/components/ui/feedback'

export type LoadMoreProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> & {
  /** How many rows are on screen right now — the length of the merged pages. */
  loaded: number
  /**
   * How many rows the current filter matches in total, **not** how many are
   * left. A `total` of `0` renders nothing at all; the empty state is the
   * page's to draw, not this component's.
   */
  total: number
  /**
   * Whether another page exists. This is the cursor
   * (`nextCursor !== null`), never `loaded < total`: `total` counts the whole
   * filtered set at the moment the page was computed, so a concurrent write
   * can leave the two disagreeing, and `loaded < total` would then either hide
   * a page that exists or offer one that doesn't.
   */
  hasMore: boolean
  /**
   * A page is in flight. Marks the button `aria-disabled` and shows the
   * spinner. See the note on the component about why this is not the real
   * `disabled` attribute.
   */
  pending?: boolean
  /** Fetch the next page and append it. */
  onLoadMore: () => void
}

/**
 * The foot of every cursor-paginated list — the count, and the control that
 * appends the next page.
 *
 * There is no mockup for this: the designs draw no pagination anywhere, so
 * the shape is assembled out of the system's existing vocabulary. The count is
 * the mono/`ink-4` quiet label the mockups use for a card's `when` stamp
 * (`gallery.pug`) and for a table's dimmest cell (`search.pug`), which is the
 * licensed use of `ink-4` — a short uppercase-or-numeric label, never a
 * sentence. The control is a plain `Button variant="outline"`, the same
 * neutral affordance already sitting in the filter panel's foot.
 *
 * The count is a polite live region because appending rows to a grid is
 * otherwise completely silent: nothing takes focus and nothing else changes,
 * so `Showing 48 of 340` is the only evidence a screen-reader user gets that
 * the button did anything.
 *
 * ⚠️ **While pending, the button takes `aria-disabled`, not the real
 * `disabled` attribute** — deliberately, and this is the one place in the app
 * that needs the distinction. A `disabled` attribute drops the element out of
 * the focus order, so pressing the button by keyboard disabled it under the
 * user's own focus and dumped them on `<body>`; loading a third page then
 * meant Tabbing from the top of the document, past every row that had just
 * been appended. `aria-disabled` keeps the button focusable and still
 * announces it as disabled, and `Button` swallows `onClick` while it is set,
 * so a double-press cannot fire a second fetch.
 */
export function LoadMore({
  loaded,
  total,
  hasMore,
  pending = false,
  onLoadMore,
  className,
  ...props
}: LoadMoreProps): JSX.Element | null {
  // `<= 0` rather than `=== 0` so a nonsense total can't render
  // `Showing 0 of -1`.
  if (total <= 0) {
    return null
  }

  return (
    <div
      {...props}
      className={cns('flex flex-col items-center gap-[13px]', className)}
    >
      <p
        aria-live="polite"
        className="font-mono text-mono-sm tabular-nums text-ink-4"
      >
        Showing {loaded} of {total}
      </p>
      {hasMore ? (
        <Button aria-disabled={pending} onClick={onLoadMore} variant="outline">
          {pending ? <Spinner /> : null}
          Load more
        </Button>
      ) : null}
    </div>
  )
}
