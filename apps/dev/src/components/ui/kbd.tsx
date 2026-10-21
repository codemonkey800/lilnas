import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

/** Inline code in running text. Ported from `dev.pug`'s `+kbd`. */
export function Kbd({
  className,
  ...props
}: ComponentPropsWithoutRef<'code'>): JSX.Element {
  return (
    <code
      {...props}
      className={cns(
        'rounded-xs bg-surface-3 px-[5px] py-px font-mono text-[0.92em] text-ink',
        className,
      )}
    />
  )
}
