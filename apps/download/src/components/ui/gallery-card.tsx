import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

export type GalleryCardProps = ComponentPropsWithoutRef<'div'>

/**
 * A grid card — poster, title, metadata, attribution. The whole card lifts on
 * hover.
 *
 * A `<div>`, never an `<a>`, and that is the point of splitting this family
 * up. The top half is a {@link GalleryCardLink}; the bottom row keeps its own
 * interactive controls (the Watch button, an avatar linking to a profile).
 * Wrapping the card in one anchor would nest those inside it, which is
 * invalid HTML and unusable with a keyboard.
 *
 * Ported from `docs/features/download/designs/src/mixins/ui.pug`'s `gcard`
 * mixin. Every remaining prop is spread onto the root element, mirroring the
 * mixin's `&attributes(attributes)` convention.
 */
export function GalleryCard({
  className,
  ...props
}: GalleryCardProps): JSX.Element {
  return (
    <div
      {...props}
      className={cns(
        'flex flex-col gap-[9px] rounded-lg border border-line bg-surface p-[9px]',
        'transition-[border-color,background-color,transform] duration-200 ease-uv',
        'hover:-translate-y-[2px] hover:border-uv hover:bg-surface-uv',
        className,
      )}
    />
  )
}

export type GalleryCardLinkProps = ComponentPropsWithoutRef<'a'>

/**
 * The link half of a {@link GalleryCard} — everything above the attribution
 * row. Carries no appearance of its own; the card it sits in owns the hover.
 *
 * Ported from `ui.pug`'s `gcardLink` mixin.
 */
export function GalleryCardLink({
  className,
  ...props
}: GalleryCardLinkProps): JSX.Element {
  return <a {...props} className={cns('flex flex-col gap-[9px]', className)} />
}

export type GalleryCardTitleProps = ComponentPropsWithoutRef<'p'>

/**
 * Card title — two lines, then ellipsis.
 *
 * `leading-[1.35]` comes *after* `text-sm` on purpose: tailwind-merge treats a
 * font size as conflicting with `leading-*`, so a size written later would
 * drop the line height. Ported from `ui.pug`'s `gcardTitle` mixin, whose
 * `text` parameter is this component's `children`.
 */
export function GalleryCardTitle({
  className,
  ...props
}: GalleryCardTitleProps): JSX.Element {
  return (
    <p
      {...props}
      className={cns(
        'line-clamp-2 text-sm leading-[1.35] font-semibold',
        className,
      )}
    />
  )
}

export type GalleryCardRowProps = ComponentPropsWithoutRef<'div'>

/**
 * A row of metadata inside a {@link GalleryCard}. The mockups hang
 * `className="mt-auto"` on the last one to push attribution to the bottom of
 * a card whose neighbours are taller.
 *
 * Ported from `ui.pug`'s `gcardRow` mixin.
 */
export function GalleryCardRow({
  className,
  ...props
}: GalleryCardRowProps): JSX.Element {
  return (
    <div
      {...props}
      className={cns(
        'flex items-center justify-between gap-1.5 px-px',
        className,
      )}
    />
  )
}

export type GalleryCardAttribProps = ComponentPropsWithoutRef<'span'>

/**
 * Who added it, and when — an `Avatar` beside a relative timestamp. Refuses to
 * wrap, and `min-w-0` lets the row beside it shrink instead.
 *
 * Ported from `ui.pug`'s `gcardAttrib` mixin.
 */
export function GalleryCardAttrib({
  className,
  ...props
}: GalleryCardAttribProps): JSX.Element {
  return (
    <span
      {...props}
      className={cns(
        'flex min-w-0 items-center gap-[5px] whitespace-nowrap',
        className,
      )}
    />
  )
}
