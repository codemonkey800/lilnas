import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

export type SpinnerProps = Omit<ComponentPropsWithoutRef<'div'>, 'children'> & {
  /** Diameter in px. */
  size?: number
}

/**
 * Indeterminate spinner: "we asked and haven't heard back". Use it only when
 * the shape of the result is unknowable (a button mid-submit, a page boot);
 * otherwise reach for `Skeleton` or `Progress`. Decorative by default; a
 * caller that wants it announced overrides `aria-hidden` and adds a
 * `role`/`aria-label`.
 */
export function Spinner({
  size = 16,
  className,
  style,
  ...props
}: SpinnerProps): JSX.Element {
  return (
    <div
      aria-hidden="true"
      {...props}
      className={cns(
        'shrink-0 animate-spin rounded-full border-2 border-line border-t-accent',
        className,
      )}
      style={{ width: size, height: size, ...style }}
    />
  )
}

export type SkeletonProps = Omit<ComponentPropsWithoutRef<'div'>, 'children'>

/**
 * Loading placeholder with the shimmer gradient. It carries no intrinsic
 * shape: the caller sets one that matches what is loading, e.g.
 * `<Skeleton className="h-4 w-32" />`.
 */
export function Skeleton({ className, ...props }: SkeletonProps): JSX.Element {
  return (
    <div aria-hidden="true" {...props} className={cns('skeleton', className)} />
  )
}

export type ProgressTone = 'accent' | 'ok' | 'bad'

const PROGRESS_FILL: Record<ProgressTone, string> = {
  accent: 'bg-accent',
  ok: 'bg-ok',
  bad: 'bg-bad',
}

/** The sliding band in the indeterminate variant reads its colour from here. */
const PROGRESS_BAND: Record<ProgressTone, string> = {
  accent: '[--band:var(--color-accent)]',
  ok: '[--band:var(--color-ok)]',
  bad: '[--band:var(--color-bad)]',
}

/** Clamps into `[0, max]`; NaN and a non-positive `max` collapse to 0. */
function clamp(value: number, max: number): number {
  if (!Number.isFinite(value) || !(max > 0)) {
    return 0
  }

  return Math.min(max, Math.max(0, value))
}

export type ProgressProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children' | 'role'
> & {
  value?: number
  max?: number
  /** `ok` when complete, `bad` when failed; the caller decides. */
  tone?: ProgressTone
  /** Ignores `value`: a 30%-wide band sliding on a 1.4s loop. */
  indeterminate?: boolean
  /** Accessible name. Pair the bar with a visible percentage beside it. */
  label?: string
}

/** Progress bar. Use whenever a real percentage exists. */
export function Progress({
  value = 0,
  max = 100,
  tone = 'accent',
  indeterminate = false,
  label,
  className,
  ...props
}: ProgressProps): JSX.Element {
  const clamped = clamp(value, max)
  const pct = max > 0 ? (clamped / max) * 100 : 0

  return (
    <div
      aria-label={label}
      aria-valuemax={max}
      aria-valuemin={0}
      aria-valuenow={indeterminate ? undefined : clamped}
      role="progressbar"
      {...props}
      className={cns(
        'h-1.5 overflow-hidden rounded-full bg-surface-2',
        className,
      )}
    >
      {indeterminate ? (
        // The theme ships no slide keyframe, so the band is a repeating
        // gradient tile (two track-widths wide, band in its first 15%) that
        // `shimmer` carries across: the tile starts offset so the band enters
        // from outside the left edge, and the 1.4s duration overrides the 1.5s.
        <span
          className={cns(
            'block h-full w-full animate-shimmer',
            '[animation-duration:1.4s]',
            'bg-[linear-gradient(90deg,var(--band)_15%,transparent_15%)]',
            'bg-[length:200%_100%] bg-[position:30%_0]',
            PROGRESS_BAND[tone],
          )}
          data-indeterminate=""
        />
      ) : (
        <span
          className={cns(
            'block h-full rounded-full',
            'transition-[width] duration-[380ms] ease-standard',
            PROGRESS_FILL[tone],
          )}
          style={{ width: `${pct}%` }}
        />
      )}
    </div>
  )
}

/** The fill turns `warn` past this share of the total... */
export const METER_WARN_PCT = 80
/** ...and `bad` past this one. */
export const METER_BAD_PCT = 95

export type MeterProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children' | 'role'
> & {
  value: number
  max: number
  /** Left of the label row, and the meter's accessible name. */
  label: string
  /** Right of the label row, in `ink-3`: "412 GB of 1 TB". */
  detail?: string
}

/** Storage / quota meter: a thicker track with a label row above it. */
export function Meter({
  value,
  max,
  label,
  detail,
  className,
  ...props
}: MeterProps): JSX.Element {
  const clamped = clamp(value, max)
  const pct = max > 0 ? (clamped / max) * 100 : 0
  const fill =
    pct > METER_BAD_PCT
      ? 'bg-bad'
      : pct > METER_WARN_PCT
        ? 'bg-warn'
        : 'bg-accent'

  return (
    <div className={cns('flex flex-col gap-1.5', className)} {...props}>
      <div className="flex items-baseline justify-between gap-3 text-sm text-ink">
        <span>{label}</span>
        {detail ? (
          <span className="text-ink-3 tabular-nums">{detail}</span>
        ) : null}
      </div>
      <div
        aria-label={label}
        aria-valuemax={max}
        aria-valuemin={0}
        aria-valuenow={clamped}
        className="h-2.5 overflow-hidden rounded-full bg-surface-2"
        role="meter"
      >
        <span
          className={cns(
            'block h-full rounded-full',
            'transition-[width,background-color] duration-[380ms] ease-standard',
            fill,
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
