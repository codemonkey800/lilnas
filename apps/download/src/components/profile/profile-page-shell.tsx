import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

/**
 * `dlMain`'s padding at both widths (`px-4 pt-5 pb-8` /
 * `px-8 pt-8 pb-12`) around `profile.pug`'s `mx-auto max-w-[1080px]`
 * column.
 *
 * ⚠️ `<main>` is the scroll container, not `<body>` — see the same note on
 * `GalleryPageShell`. The shell's `<body>` is `h-full flex flex-col` with the
 * app bar `shrink-0` above this, and the nav search's mobile overlay is `fixed`
 * against the viewport top, which making the document scroll would slide the bar
 * out from under.
 */
const PROFILE_SHELL = cns(
  'flex-auto overflow-y-auto px-4 pt-5 pb-8',
  'sm:px-8 sm:pt-8 sm:pb-12',
)

/** The small uppercase caption over each block — `By type`, `By status`, `Last 30 days`. */
export const PROFILE_GROUP_LABEL = 'text-label uppercase text-ink-3'

export type ProfilePageShellProps = ComponentPropsWithoutRef<'main'>

/**
 * The profile route's page frame, shared by the page itself, its loading
 * skeleton and its error boundary so all three occupy exactly the same column
 * and nothing shifts as one replaces another.
 */
export function ProfilePageShell({
  children,
  className,
  ...props
}: ProfilePageShellProps): JSX.Element {
  return (
    <main {...props} className={cns(PROFILE_SHELL, className)}>
      <div className="mx-auto max-w-[1080px]">{children}</div>
    </main>
  )
}
