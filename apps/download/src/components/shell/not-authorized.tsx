import { Button, Card, Icon } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

import { LIBRARY_HREF } from 'src/components/detail/library-link'

/**
 * The heading. Deliberately general: the same panel answers "this is someone
 * else's profile and you are not an admin" and "this dashboard is admin-only",
 * and a reader learns nothing from being told *which* rule they fell foul of.
 */
export const NOT_AUTHORIZED_TITLE = 'No access to this page'

/**
 * The explanatory sentence. Says the account is the reason, says nothing is
 * broken, and says who to ask — all three read correctly for a foreign profile
 * and for the admin dashboard. A call site with something more specific to add
 * passes its own `description`.
 */
export const NOT_AUTHORIZED_DESCRIPTION =
  'Your account isn’t on the list for this page. Nothing has gone wrong — ask an admin if you think you should be able to see it.'

/** The label on the back link. */
export const NOT_AUTHORIZED_BACK_LABEL = 'Back to library'

export type NotAuthorizedProps = Omit<
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
 * "You are not allowed to see this", as a page's whole body: a shield icon, a
 * heading, one sentence and one way out, in a sunk `Card`. No mascot — that
 * belongs to empty states only.
 *
 * Shared on purpose. Two routes need this state — `/profile?user=…` for a
 * profile that is neither yours nor visible to you as an admin, and `/admin`
 * for the admin-only dashboard — and if each grew its own the two would drift.
 *
 * Quiet, not loud, and specifically *not* the error boundary's register: no
 * `bad` ink, no `role="alert"`. Nothing has failed — the app is answering the
 * question it was asked.
 *
 * Presentational and server-safe: no `'use client'`, no hooks, no handlers, so
 * a server component can decide the viewer isn't allowed and render this
 * directly instead of throwing into a boundary. The heading is an `<h2>`, so
 * the route still owes the document an `<h1>`; pair it with an `sr-only` one:
 *
 * ```tsx
 * <h1 className="sr-only">Profile</h1>
 * <NotAuthorized description={…} />
 * ```
 */
export function NotAuthorized({
  title = NOT_AUTHORIZED_TITLE,
  description = NOT_AUTHORIZED_DESCRIPTION,
  backHref = LIBRARY_HREF,
  backLabel = NOT_AUTHORIZED_BACK_LABEL,
  className,
  ...props
}: NotAuthorizedProps): JSX.Element {
  return (
    <Card
      {...props}
      className={cns(
        'mx-auto flex max-w-[560px] flex-col items-center gap-2.5 px-6 py-12 text-center',
        className,
      )}
      variant="sunk"
    >
      <Icon className="text-ink-3" name="shield" size={24} />
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
