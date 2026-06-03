import { cns } from '@lilnas/utils/cns'

import { TREND_GLYPH, TREND_LABEL } from 'src/lib/stats'

type Props = {
  label: string
  value: string
  hero?: boolean
  /** Optional signed delta string, e.g. "+2" or "−1". */
  delta?: string
  /** Optional trend arrow rendered with the value. */
  trend?: 'up' | 'flat' | 'down'
}

export function StatTile({ label, value, hero, delta, trend }: Props) {
  const trendLabel = trend ? TREND_LABEL[trend] : undefined
  const ariaLabel = trendLabel
    ? `${label}: ${value}${delta ? ` ${delta}` : ''}, ${trendLabel}`
    : undefined

  return (
    <div
      className="flex flex-col gap-1 rounded-xl border border-neutral-800 bg-neutral-900/80 p-4"
      aria-label={ariaLabel}
    >
      <span className="text-xs font-medium uppercase tracking-wider text-neutral-400">
        {label}
      </span>
      <span
        className={cns(
          'font-semibold',
          hero ? 'text-2xl text-orange-500' : 'text-lg text-white',
        )}
      >
        {value}
        {(trend || delta) && (
          <span
            className={cns(
              'ml-1.5 text-sm font-medium',
              trend === 'up' ? 'text-orange-500' : 'text-neutral-400',
            )}
          >
            {trend && (
              <>
                <span aria-hidden="true">{TREND_GLYPH[trend]}</span>
                <span className="sr-only">{TREND_LABEL[trend]}</span>
              </>
            )}
            {delta && <span aria-hidden="true"> {delta}</span>}
          </span>
        )}
      </span>
    </div>
  )
}
