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

/** The lowest and highest percentages a `Bar` will render. */
export const BAR_MIN_PCT = 0
export const BAR_MAX_PCT = 100

/**
 * Clamps a percentage into 0-100. Progress arrives from the backend, where a
 * job that overshoots its own estimate or reports before it has started is a
 * real possibility — neither should paint outside the track.
 */
export function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) {
    return BAR_MIN_PCT
  }

  return Math.min(BAR_MAX_PCT, Math.max(BAR_MIN_PCT, pct))
}

export type BarProps = Omit<ComponentPropsWithoutRef<'div'>, 'children'> & {
  /** Progress, 0-100. Values outside that range are clamped. */
  pct: number
  /**
   * The number is done but the work is not - a full download that has not
   * reached the library yet. A band of light sweeps along the fill so the bar
   * keeps moving after its percentage has stopped. Say what is happening in
   * text beside it too: under reduced motion the sweep does not run.
   */
  settling?: boolean
}

/** Determinate progress bar. */
export function Bar({
  pct,
  className,
  settling = false,
  ...props
}: BarProps): JSX.Element {
  const value = clampPct(pct)

  return (
    <div
      aria-valuemax={BAR_MAX_PCT}
      aria-valuemin={BAR_MIN_PCT}
      aria-valuenow={value}
      role="progressbar"
      {...props}
      className={cns(
        'h-[5px] overflow-hidden rounded-full bg-surface-3',
        className,
      )}
    >
      <span
        className={cns(
          'block h-full rounded-full bg-uv',
          'transition-[width] duration-[380ms] ease-uv',
          settling && 'bar-settling',
        )}
        data-settling={settling || undefined}
        style={{ width: `${value}%` }}
      />
    </div>
  )
}
