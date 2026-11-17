import { Progress, type ProgressProps } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

/** The lowest and highest percentages a bar will render. */
export const PCT_MIN = 0
export const PCT_MAX = 100

/**
 * Clamps a percentage into 0-100. Progress arrives from the backend, where a
 * job that overshoots its own estimate or reports before it has started is a
 * real possibility — neither should paint outside the track.
 */
export function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) {
    return PCT_MIN
  }

  return Math.min(PCT_MAX, Math.max(PCT_MIN, pct))
}

export type SettlingProgressProps = Omit<
  ProgressProps,
  'indeterminate' | 'max' | 'value'
> & {
  /** Progress, 0-100. Values outside that range are clamped. */
  pct: number
  /**
   * The number is done but the work is not — a full download that has not
   * reached the library yet. A band of light sweeps along the fill so the bar
   * keeps moving after its percentage has stopped. Say what is happening in
   * text beside it too: under reduced motion the sweep does not run.
   */
  settling?: boolean
}

/**
 * `@lilnas/ui`'s `Progress` with the one thing only this app needs: a sweep
 * (`bar-settling`, see `src/tailwind.css`) over a full bar whose work isn't
 * done. The fill is the package's inner span, so the utility is applied
 * through a child selector.
 */
export function SettlingProgress({
  pct,
  settling = false,
  className,
  ...props
}: SettlingProgressProps): JSX.Element {
  return (
    <Progress
      {...props}
      className={cns(settling && '[&>span]:bar-settling', className)}
      data-settling={settling || undefined}
      value={clampPct(pct)}
    />
  )
}
