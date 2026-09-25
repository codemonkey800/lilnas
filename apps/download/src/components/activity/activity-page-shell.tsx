import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

/**
 * `mock.pug`'s `appBody` at both widths (`px-6 pt-[18px] pb-[30px]` /
 * `px-8 pt-[30px] pb-11`) around `downloads-activity.pug`'s
 * `mx-auto max-w-[1080px]` column.
 *
 * ⚠️ `<main>` is the scroll container, not `<body>` — see the same note on
 * `GalleryPageShell`. The shell's `<body>` is `h-full flex flex-col` with the
 * app bar `shrink-0` above this, and the nav search's mobile overlay is `fixed`
 * against the viewport top, which making the document scroll would slide the bar
 * out from under.
 */
const ACTIVITY_SHELL = cns(
  'flex-auto overflow-y-auto px-6 pt-[18px] pb-[30px]',
  'sm:px-8 sm:pt-[30px] sm:pb-11',
)

/**
 * The page title. `downloads-activity.pug` writes it `text-[22px]` on desktop
 * and `text-[20px]` on mobile; `text-h1` is the token those two round to (23px,
 * the same 1.25 leading, the same 650 weight and the same -0.015em tracking),
 * and the token is what the rest of the app's headings are written in.
 */
export const ACTIVITY_TITLE = 'mb-4 text-h1 sm:mb-5'

export type ActivityPageShellProps = ComponentPropsWithoutRef<'main'>

/**
 * The activity route's page frame, shared by the page itself, its loading
 * skeleton and its error boundary so all three occupy exactly the same column
 * and nothing shifts as one replaces another.
 */
export function ActivityPageShell({
  children,
  className,
  ...props
}: ActivityPageShellProps): JSX.Element {
  return (
    <main {...props} className={cns(ACTIVITY_SHELL, className)}>
      <div className="mx-auto max-w-[1080px]">{children}</div>
    </main>
  )
}
