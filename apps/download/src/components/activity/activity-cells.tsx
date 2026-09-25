import { cns } from '@lilnas/utils/cns'
import type { DownloadJob } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import type { JSX } from 'react'

import { isMoving, jobProgressPct } from 'src/components/activity/activity-rows'
import { Chip } from 'src/components/ui/chip'
import type { IconName } from 'src/components/ui/icon'
import { Icon } from 'src/components/ui/icon'
import { MChip } from 'src/components/ui/mchip'
import { Poster } from 'src/components/ui/poster'
import { Bar, Dot } from 'src/components/ui/status'
import { statusTone, UNKNOWN_VALUE } from 'src/lib/format'

/** The mono/`ink-3` register every machine annotation in a row is written in. */
export const ROW_META = 'font-mono text-mono-sm text-ink-3'

/** Same register, dimmed to the licensed `ink-4` for an em-dash empty. */
export const ROW_META_EMPTY = 'font-mono text-mono-sm text-ink-4'

const TYPE_ICONS: Record<DownloadType, IconName> = {
  [DownloadType.Movie]: 'film',
  [DownloadType.Show]: 'tv',
  [DownloadType.Video]: 'play',
}

/**
 * Lowercase, matching the mono register this sits in — the table's own column
 * headers and the status chip beside it are lowercase too. It is the machine
 * annotating, not a proper noun.
 */
const TYPE_LABELS: Record<DownloadType, string> = {
  [DownloadType.Movie]: 'movie',
  [DownloadType.Show]: 'show',
  [DownloadType.Video]: 'video',
}

export type ActivityArtProps = {
  job: DownloadJob
}

/**
 * A feed row's thumbnail: 34px wide, squarer-cornered than a poster elsewhere
 * (at this size a 10px radius reads as a blob), and always the **tall** 2:3
 * crop so a video row sits at the same height as a movie row — a wide video
 * thumbnail here made the feed's row heights saw-tooth.
 *
 * The play glyph is passed as `children` rather than through `Poster`'s `play`
 * prop, because `play` also paints a scrim gradient that art this small does
 * not want.
 */
export function ActivityArt({ job }: ActivityArtProps): JSX.Element {
  return (
    <Poster
      className="w-[34px]"
      radius="rounded-xs"
      seed={job.media.id}
      shape="tall"
      src={job.media.posterUrl}
    >
      {job.media.type === DownloadType.Video ? (
        <Icon
          className="relative z-1 h-[14px] w-[14px] text-ink-3"
          name="play"
        />
      ) : null}
    </Poster>
  )
}

export type ActivityTypeChipProps = {
  job: DownloadJob
}

/** `film movie` / `tv show` / `play video`, in the mono row register. */
export function ActivityTypeChip({ job }: ActivityTypeChipProps): JSX.Element {
  return (
    <MChip
      className={ROW_META}
      icon={TYPE_ICONS[job.media.type]}
      label={TYPE_LABELS[job.media.type]}
    />
  )
}

export type ActivityStatusChipProps = {
  /** Overrides the status word, which the stacked row uses for the percentage. */
  className?: string
  job: DownloadJob
  label?: string
}

/**
 * The status chip, carrying the breathing `live` dot whenever the machine is
 * actually moving the job along.
 *
 * ⚠️ The tint comes from `statusTone`, never from a mapping written here — so
 * `paused` is `warn` (a user intervened), `pending` is `mute` (inert) and
 * `downloading` is `uv` (working). `downloads-activity.mjs` hand-picks `ok` for
 * a downloading row and `mute` for a paused one; those are the mockup's own
 * palette choices for a static picture, and the shipped vocabulary is the one
 * the rest of the app — the admin dashboard, the detail pages — reads by.
 *
 * The dot is *not* suppressed when the socket is down. It states the job's
 * status, which is a server fact that does not stop being true because this tab
 * stopped hearing about it; the feed's own connection marker is what says the
 * page has gone stale, once, instead of nine rows each implying it.
 */
export function ActivityStatusChip({
  className,
  job,
  label,
}: ActivityStatusChipProps): JSX.Element {
  const moving = isMoving(job)
  const text = label ?? job.status

  return moving ? (
    <Chip className={className} tone={statusTone(job.status)}>
      <Dot tone="live" />
      {text}
    </Chip>
  ) : (
    <Chip className={className} label={text} tone={statusTone(job.status)} />
  )
}

export type ActivityProgressProps = {
  job: DownloadJob
}

/**
 * The progress column: a bar plus the figure, or an em dash when there is none.
 *
 * ⚠️ `Bar` takes `role="presentation"` here. It emits `role="progressbar"` and
 * its `aria-value*` triple *before* the prop spread precisely so a call site
 * that renders the same number as text beside it can hand the fact to the text
 * instead — otherwise a screen reader reads this cell twice, once as a progress
 * bar at 64% and once as "64%".
 *
 * The figure is `uv-hi` while the machine is moving and the quieter `ink-3`
 * when it is not, which is `downloads-activity.mjs`'s `quietProgress` derived
 * from the status rather than hand-set per row.
 */
export function ActivityProgress({ job }: ActivityProgressProps): JSX.Element {
  const pct = jobProgressPct(job)

  if (pct === null) {
    return <span className={ROW_META_EMPTY}>{UNKNOWN_VALUE}</span>
  }

  return (
    <div className="flex w-[140px] items-center gap-2">
      <Bar className="flex-1" pct={pct} role="presentation" />
      <span
        className={cns(
          'font-mono text-mono-sm tabular-nums',
          isMoving(job) ? 'text-uv-hi' : 'text-ink-3',
        )}
      >
        {pct}%
      </span>
    </div>
  )
}
