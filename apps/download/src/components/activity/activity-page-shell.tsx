import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

/**
 * `dlMain`'s padding at both widths (`px-4 pt-5 pb-8` /
 * `px-8 pt-8 pb-12`) around `downloads-activity.pug`'s
 * `mx-auto max-w-[1080px]` column.
 *
 * ⚠️ `<main>` is the scroll container, not `<body>` — see the same note on
 * `GalleryPageShell`. The shell's `<body>` is `h-full flex flex-col` with the
 * app bar `shrink-0` above this, and the nav search's mobile overlay is `fixed`
 * against the viewport top, which making the document scroll would slide the bar
 * out from under.
 */
const ACTIVITY_SHELL = cns(
  'flex-auto overflow-y-auto px-4 pt-5 pb-8',
  'sm:px-8 sm:pt-8 sm:pb-12',
)

/** The page title, in the `h1` token. */
export const ACTIVITY_TITLE = 'text-h1'

/** The one string the page, its skeleton and its error boundary all title with. */
export const ACTIVITY_TITLE_TEXT = 'Activity'

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
