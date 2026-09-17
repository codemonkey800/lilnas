import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

import { LIBRARY_HREF } from 'src/components/detail/library-link'
import { ButtonLink } from 'src/components/ui/button-link'
import { Card } from 'src/components/ui/card'
import type { IconName } from 'src/components/ui/icon'
import { Icon } from 'src/components/ui/icon'

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
export const NOT_AUTHORIZED_BACK_LABEL = 'Library'

/**
 * `shield` rather than `alert`. `alert` is this system's error register (it is
 * `Note`'s default, and what the loud `border-bad/35!` override pairs with);
 * this panel is a rule being stated, not a fault being reported.
 */
export const NOT_AUTHORIZED_ICON: IconName = 'shield'

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
 * "You are not allowed to see this", as a page's whole body.
 *
 * Shared on purpose. Two routes need this state — `/profile?user=…` for a
 * profile that is neither yours nor visible to you as an admin, and `/admin`
 * for the admin-only dashboard — and if each grew its own the two would drift,
 * the way the ghost-styled watch link did when the home grid and
 * `gallery-item-card.tsx` each kept their own copy of it, before both were
 * folded into `ui/button-link.tsx`.
 *
 * Quiet, not loud, and specifically *not* the error boundary's register: no
 * `bad` ink, no `role="alert"`. Nothing has failed — the app is answering the
 * question it was asked. That is the same reading as
 * `app/videos/[videoId]/not-found.tsx`, and it wears the same centred sunk
 * panel as `GalleryEmpty` / `ActivityEmpty` (`+card({ sunk: true })` from
 * `ui.pug`, with the call site's own padding).
 *
 * Presentational and server-safe: no `'use client'`, no hooks, no handlers, so
 * a server component can decide the viewer isn't allowed and render this
 * directly instead of throwing into a boundary.
 *
 * The heading is an `<h2>`, not an `<h1>`. The panel is page *content*, and
 * every route in this app titles itself — usually with an `sr-only` `<h1>`, as
 * `app/gallery/page.tsx` and `videos/[videoId]/not-found.tsx` both do. Pair it
 * with one:
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
      sunk
      {...props}
      className={cns(
        'mx-auto flex max-w-[560px] flex-col items-center gap-2.5',
        'px-6 py-12 text-center',
        className,
      )}
    >
      <Icon className={cns('h-6 w-6 text-ink-4')} name={NOT_AUTHORIZED_ICON} />
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
