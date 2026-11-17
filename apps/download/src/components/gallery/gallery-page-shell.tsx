import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import type { PageMainProps } from 'src/components/shell/page-main'
import { PageMain } from 'src/components/shell/page-main'

export type GalleryPageShellProps = PageMainProps

/**
 * The gallery's page body: the shell's standard `PageMain` (`dlMain` at both
 * widths, `gallery.pug`'s 1080px column).
 *
 * ⚠️ `<main>` is the scroll container, not `<body>`. The shell's `<body>` is
 * `h-full flex flex-col` with the app bar `shrink-0` above this, so
 * `flex-auto` takes the remaining column height and `overflow-y-auto` keeps
 * the scrolling here, under the bar.
 */
export function GalleryPageShell({
  className,
  ...props
}: GalleryPageShellProps): JSX.Element {
  return <PageMain {...props} className={cns('overflow-y-auto', className)} />
}
