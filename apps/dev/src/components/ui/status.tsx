import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

export type DotTone = 'live' | 'ok' | 'warn' | 'bad'

/**
 * `live` is the only tone that isn't a flat fill — `dot-live` is a custom
 * utility that paints the dot *and* hangs a breathing ring off a
 * pseudo-element, which a utility stack on the dot itself can't express.
 */
const DOT_TONES: Record<DotTone, string> = {
  live: 'dot-live',
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
}

export type DotProps = Omit<ComponentPropsWithoutRef<'span'>, 'children'> & {
  /** Omitted renders the inert `ink-4` dot. */
  tone?: DotTone
}

/** Status dot. Decorative — the state it marks is always spelled out nearby. */
export function Dot({ tone, className, ...props }: DotProps): JSX.Element {
  return (
    <span
      aria-hidden="true"
      {...props}
      className={cns(
        'h-[7px] w-[7px] shrink-0 rounded-full',
        tone ? DOT_TONES[tone] : 'bg-ink-4',
        className,
      )}
    />
  )
}
