import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

export type PageMainProps = ComponentPropsWithoutRef<'main'> & {
  /** A 720px column, for a screen that is one panel (the boundaries). */
  narrow?: boolean
}

/**
 * A screen's body, as every mockup's `dlMain` draws it: padding by viewport,
 * content in a centred 1080px column.
 */
export function PageMain({
  narrow = false,
  className,
  children,
  ...props
}: PageMainProps): JSX.Element {
  return (
    <main
      {...props}
      className={cns(
        'flex-auto px-4 pt-5 pb-8 sm:px-8 sm:pt-8 sm:pb-12',
        className,
      )}
    >
      <div
        className={cns('mx-auto', narrow ? 'max-w-[720px]' : 'max-w-[1080px]')}
      >
        {children}
      </div>
    </main>
  )
}
