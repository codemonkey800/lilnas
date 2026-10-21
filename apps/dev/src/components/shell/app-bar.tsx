import type { JSX } from 'react'

import { Doorplate } from 'src/components/ui/doorplate'

/** The doorplate is the way out to the lilnas portal, not back to this page. */
export const HOME_HREF = 'https://lilnas.io'

/** The app this bar belongs to, in mono on the doorplate. */
export const APP_NAME = 'dev.lilnas.io'

/**
 * The app bar from the mockup's `topBar`: the doorplate on the left. The
 * dashboard has no search and no account menu, so there is nothing on the
 * right.
 */
export function AppBar(): JSX.Element {
  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line-soft bg-bg-sunk px-4 py-2.5 sm:py-[11px]">
      <Doorplate href={HOME_HREF} name={APP_NAME} />
    </header>
  )
}
