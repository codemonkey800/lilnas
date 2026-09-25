import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

/**
 * `mock.pug`'s `appBody` at both widths (`px-6 pt-[18px] pb-[30px]` /
 * `px-8 pt-[30px] pb-11`) around `gallery.pug`'s `mx-auto max-w-[1080px]`
 * column.
 *
 * ⚠️ `<main>` is the scroll container, not `<body>`. The shell's `<body>` is
 * `h-full flex flex-col` with the app bar `shrink-0` above this, and the nav
 * search's mobile overlay is `fixed` against the viewport top — making the
 * document scroll instead would slide the bar out from under that overlay.
 * `flex-auto` takes the remaining column height and `overflow-y-auto` keeps the
 * scrolling here.
 */
const GALLERY_SHELL = cns(
  'flex-auto overflow-y-auto px-6 pt-[18px] pb-[30px]',
  'sm:px-8 sm:pt-[30px] sm:pb-11',
)

export type GalleryPageShellProps = ComponentPropsWithoutRef<'main'>

/**
 * The gallery route's page frame, shared by the page itself, its loading
 * skeleton and its error boundary so that all three occupy exactly the same
 * column and nothing shifts as one replaces another.
 */
export function GalleryPageShell({
  children,
  className,
  ...props
}: GalleryPageShellProps): JSX.Element {
  return (
    <main {...props} className={cns(GALLERY_SHELL, className)}>
      <div className="mx-auto max-w-[1080px]">{children}</div>
    </main>
  )
}
