import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithRef, JSX } from 'react'

export type StatusDotTone = 'ok' | 'accent' | 'warn' | 'bad' | 'idle'

const DOT: Record<StatusDotTone, string> = {
  ok: 'bg-ok',
  accent: 'bg-accent',
  warn: 'bg-warn',
  bad: 'bg-bad',
  idle: 'bg-ink-4',
}

const RING: Record<StatusDotTone, string> = {
  ok: 'border-ok',
  accent: 'border-accent',
  warn: 'border-warn',
  bad: 'border-bad',
  idle: 'border-ink-4',
}

export type StatusDotProps = Omit<
  ComponentPropsWithRef<'span'>,
  'children' | 'color'
> & {
  tone?: StatusDotTone
  /**
   * Ring that breathes outward. Only honoured for `ok` and `accent`: problems
   * don't blink, and idle things have nothing to say.
   */
  pulse?: boolean
}

/**
 * 8px state dot. Decorative — the state it marks is always spelled out in
 * words nearby — so it is `aria-hidden`.
 */
export function StatusDot({
  tone = 'idle',
  pulse = false,
  className,
  ...props
}: StatusDotProps): JSX.Element {
  const pulsing = pulse && (tone === 'ok' || tone === 'accent')

  return (
    <span
      aria-hidden="true"
      data-pulse={pulsing ? '' : undefined}
      {...props}
      className={cns(
        'relative inline-block size-2 shrink-0 rounded-full',
        DOT[tone],
        className,
      )}
    >
      {pulsing ? (
        <span
          className={cns(
            'absolute inset-0 animate-breathe rounded-full border-[1.5px] motion-reduce:hidden',
            RING[tone],
          )}
        />
      ) : null}
    </span>
  )
}
