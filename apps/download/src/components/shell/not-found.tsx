import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

import { LIBRARY_HREF } from 'src/components/detail/library-link'
import { ButtonLink } from 'src/components/ui/button-link'
import { Card } from 'src/components/ui/card'
import type { IconName } from 'src/components/ui/icon'
import { Icon } from 'src/components/ui/icon'

/**
 * The heading. Deliberately about the *address* rather than about the thing
 * behind it: the root boundary catches a mistyped path, a stale bookmark and a
 * segment that never parsed, and a reader learns nothing from being told which.
 */
export const NOT_FOUND_TITLE = 'No page at this address'

/**
 * The explanatory sentence. Says nothing is broken (the one wrong conclusion
 * this state invites), says the address is the reason, and points at the one
 * place that does have everything.
 */
export const NOT_FOUND_DESCRIPTION =
  'Nothing in the app answers to this address. Nothing has gone wrong — the link was probably mistyped, or it points at something that has since been removed.'

/** The label on the back link. */
export const NOT_FOUND_BACK_LABEL = 'Library'

/**
 * `search` rather than `alert`.
 *
 * `alert` is this system's **error** register — it is `Note`'s default, and the
 * icon the loud `border-bad/35!` override pairs with. A 404 is not a fault: the
 * app looked, and there is nothing at this address. `shield` is equally wrong
 * and already spoken for; it is `NotAuthorized`'s, and it means "a rule applies
 * to you", which is a different answer that a reader must never confuse with
 * this one. `search` is the register of a lookup that came back empty, and it
 * is also the affordance the copy sends people to.
 */
export const NOT_FOUND_ICON: IconName = 'search'

export type NotFoundProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> & {
  /** Overrides the default heading. */
  title?: string
  /** Overrides the default explanatory sentence. */
  description?: string
  /** Where "back" goes. Defaults to the library root. */
  backHref?: string
  /** Label for the back link. */
  backLabel?: string
}

/**
 * "There is nothing here", as a page's whole body.
 *
 * Shared on purpose, and a deliberate sibling of
 * `src/components/shell/not-authorized.tsx` — same centred sunk panel, same
 * icon/heading/sentence/back-link order, same `<h2>`. The two states are
 * adjacent answers to the same press ("I asked for a page and did not get it"),
 * and two unrelated designs for them is exactly the drift that put four copies
 * of the library breadcrumb in the mockups before `LibraryLink` absorbed them.
 *
 * Two routes render it: `src/app/not-found.tsx` (the app's global 404, which
 * catches both an unmatched path and any `notFound()` thrown outside a segment
 * that has its own boundary) and `src/app/videos/[videoId]/not-found.tsx`,
 * which keeps its own copy because a missing *video* is a materially different
 * fact from a missing page — see that file.
 *
 * Quiet, not loud, and specifically **not** the error boundary's register: no
 * `bad` ink, no `role="alert"`. Nothing has failed.
 *
 * Presentational and server-safe: no `'use client'`, no hooks, no handlers, so
 * a `not-found.tsx` (which Next renders on the server) can use it directly.
 *
 * The heading is an `<h2>`, not an `<h1>`. The panel is page *content*, and
 * every route in this app titles itself — usually with an `sr-only` `<h1>`.
 * Pair it with one:
 *
 * ```tsx
 * <h1 className="sr-only">{NOT_FOUND_TITLE}</h1>
 * <NotFound />
 * ```
 */
export function NotFound({
  title = NOT_FOUND_TITLE,
  description = NOT_FOUND_DESCRIPTION,
  backHref = LIBRARY_HREF,
  backLabel = NOT_FOUND_BACK_LABEL,
  className,
  ...props
}: NotFoundProps): JSX.Element {
  return (
    <Card
      sunk
      {...props}
      className={cns(
        'mx-auto flex max-w-[560px] flex-col items-center gap-2.5',
        'px-6 py-12 text-center',
        className,
      )}
    >
      <Icon className={cns('h-6 w-6 text-ink-4')} name={NOT_FOUND_ICON} />
      <h2 className={cns('text-h2')}>{title}</h2>
      <p className={cns('max-w-[52ch] text-sm text-ink-3')}>{description}</p>
      <ButtonLink
        className={cns('mt-2.5')}
        href={backHref}
        icon="grid"
        size="sm"
        variant="outline"
      >
        {backLabel}
      </ButtonLink>
    </Card>
  )
}
