import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

/**
 * `mock.pug`'s `appBody` at both widths (`px-6 pt-[18px] pb-[30px]` /
 * `px-8 pt-[30px] pb-11`) around `show-detail.pug`'s
 * `mx-auto max-w-[1080px]` column.
 *
 * ⚠️ `<main>` is the scroll container, not `<body>` - the same note
 * `GalleryPageShell` and `ActivityPageShell` both carry. The shell's `<body>`
 * is `h-full flex flex-col` with the app bar `shrink-0` above this, and the nav
 * search's mobile overlay is `fixed` against the viewport top, which making the
 * document scroll would slide the bar out from under.
 *
 * Its own tiny module rather than an export of `show-detail.tsx` so that
 * `error.tsx` - a client boundary - can share the frame without dragging the
 * whole detail tree (and with it `ReleasePicker`, `DeleteConfirm` and the
 * seasons panel) into its bundle.
 */
const SHOW_SHELL = cns(
  'flex-auto overflow-y-auto px-6 pt-[18px] pb-[30px]',
  'sm:px-8 sm:pt-[30px] sm:pb-11',
)

export type ShowPageShellProps = ComponentPropsWithoutRef<'main'>

/**
 * `/shows/<tvdbId>`'s page frame, shared by the page, its loading skeleton and
 * its error boundary so that all three occupy exactly the same column and
 * nothing shifts as one replaces another.
 */
export function ShowPageShell({
  children,
  className,
  ...props
}: ShowPageShellProps): JSX.Element {
  return (
    <main {...props} className={cns(SHOW_SHELL, className)}>
      <div className="mx-auto max-w-[1080px]">{children}</div>
    </main>
  )
}
