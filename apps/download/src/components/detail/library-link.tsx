import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

import { Icon } from 'src/components/ui/icon'

/** Where "Library" goes - the unified gallery, `src/app/gallery/page.tsx`. */
export const LIBRARY_HREF = '/gallery'

export type LibraryLinkProps = Omit<
  ComponentPropsWithoutRef<'a'>,
  'children'
> & {
  /** Where back *is*. Defaults to {@link LIBRARY_HREF}. */
  href?: string
  /** The link text. Defaults to `'Library'`. */
  label?: string
}

/**
 * The breadcrumb at the top of every detail page's body, one step back up to
 * the gallery.
 *
 * Ported from the `libraryLink` mixin that `movie-detail.pug` and
 * `show-detail.pug` each keep a copy of, and that `video-detail.pug` spells
 * inline twice - four copies of six lines, which is exactly the drift this
 * task exists to stop.
 *
 * A real `<a>`, not a `<button onClick={router.back}>`: this is a fixed
 * destination rather than "wherever you came from", so it has to survive
 * middle-click, ⌘-click and a deep link arrived at cold. The app uses plain
 * anchors throughout rather than `next/link`.
 *
 * The `mb-[22px]` is the mixin's own and travels with the component because
 * every call site in the mockups wants it; `cns` is `twMerge`, so a page that
 * does not can override it from `className`.
 */
export function LibraryLink({
  className,
  href = LIBRARY_HREF,
  label = 'Library',
  ...props
}: LibraryLinkProps): JSX.Element {
  return (
    <a
      {...props}
      className={cns('mb-[22px] flex items-center gap-1.5', className)}
      href={href}
    >
      <Icon
        className={cns('h-[13px] w-[13px] -scale-x-100 text-ink-4')}
        name="arrow"
      />
      <span className={cns('text-sm text-ink-3')}>{label}</span>
    </a>
  )
}
