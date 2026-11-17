import { Button, Card, Icon } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

import { LIBRARY_HREF } from 'src/components/detail/library-link'

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
export const NOT_FOUND_BACK_LABEL = 'Back to library'

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
 * "There is nothing here", as a page's whole body: a search icon, a heading,
 * one sentence and one way out, in a sunk `Card`. No mascot — that belongs to
 * empty states only, and a 404 is not one.
 *
 * Shared on purpose, and a deliberate sibling of
 * `src/components/shell/not-authorized.tsx` — the same quiet panel in the same
 * order. The two states are adjacent answers to the same press ("I asked for a
 * page and did not get it"), and two unrelated designs for them is exactly the
 * drift the shared panel exists to prevent.
 *
 * Quiet, not loud, and specifically **not** the error boundary's register: no
 * `bad` ink, no `role="alert"`. Nothing has failed.
 *
 * Presentational and server-safe: no `'use client'`, no hooks, no handlers.
 * The heading is an `<h2>`, so the route still owes the document an `<h1>` —
 * pair it with an `sr-only` one:
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
      {...props}
      className={cns(
        'mx-auto flex max-w-[560px] flex-col items-center gap-2.5 px-6 py-12 text-center',
        className,
      )}
      variant="sunk"
    >
      <Icon className="text-ink-3" name="search" size={24} />
      <h2 className="text-h2">{title}</h2>
      <p className="max-w-[52ch] text-sm text-ink-3">{description}</p>
      <Button
        className="mt-2"
        icon="grid"
        render={<a href={backHref} />}
        size="sm"
        variant="outline"
      >
        {backLabel}
      </Button>
    </Card>
  )
}
