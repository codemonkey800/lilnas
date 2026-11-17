import { Card } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'

export type StatTilesProps = {
  people: number
  granted: number
  pending: number
}

function StatTile({
  value,
  label,
  flagged = false,
}: {
  value: number
  label: string
  flagged?: boolean
}) {
  return (
    <Card
      className={cns(
        'flex flex-col gap-0.5',
        flagged && 'border-warn/40 bg-warn-ghost',
      )}
      data-flagged={flagged ? '' : undefined}
    >
      <span
        className={cns(
          'text-[28px] leading-9 font-semibold tracking-[-0.02em] tabular-nums',
          flagged ? 'text-warn' : 'text-ink',
        )}
      >
        {value}
      </span>
      <span className="text-cap text-ink-3">{label}</span>
    </Card>
  )
}

// The three numbers at the top. Pending is flagged `warn` whenever there is
// something waiting.
export function StatTiles({ people, granted, pending }: StatTilesProps) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <StatTile value={people} label="People" />
      <StatTile value={granted} label="Granted" />
      <StatTile value={pending} label="Pending" flagged={pending > 0} />
    </div>
  )
}
