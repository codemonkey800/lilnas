import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithRef, JSX } from 'react'

import { StatusDot } from '../status-dot'

export type BadgeTone = 'mute' | 'accent' | 'ok' | 'warn' | 'bad'

const TONES: Record<BadgeTone, string> = {
  mute: 'bg-surface-2 text-ink-3',
  accent: 'bg-accent-ghost text-accent-hi',
  ok: 'bg-ok-ghost text-ok',
  warn: 'bg-warn-ghost text-warn',
  bad: 'bg-bad-ghost text-bad',
}

export type BadgeProps = Omit<ComponentPropsWithRef<'span'>, 'onClick'> & {
  tone?: BadgeTone
  /** Swaps the static dot for a pulsing `StatusDot`; only `accent` and `ok` pulse. */
  live?: boolean
}

/**
 * A soft tinted pill with a leading dot: a label, never a control. Sentence
 * case, one or two words. Something clickable is a `Button`.
 */
export function Badge({
  tone = 'mute',
  live = false,
  className,
  children,
  ...props
}: BadgeProps): JSX.Element {
  const pulsing = live && (tone === 'accent' || tone === 'ok')

  return (
    <span
      {...props}
      className={cns(
        'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {pulsing ? (
        <StatusDot pulse tone={tone === 'ok' ? 'ok' : 'accent'} />
      ) : (
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-current"
        />
      )}
      {children}
    </span>
  )
}
