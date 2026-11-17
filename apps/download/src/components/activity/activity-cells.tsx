import { Badge, Icon, type IconName } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { DownloadJob } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import type { JSX } from 'react'

import { isMoving, jobProgressPct } from 'src/components/activity/activity-rows'
import { jobChipLabel, jobHandoff } from 'src/components/detail/job-state'
import { MChip } from 'src/components/ui/mchip'
import { Poster } from 'src/components/ui/poster'
import { SettlingProgress } from 'src/components/ui/settling-progress'
import { statusTone, UNKNOWN_VALUE } from 'src/lib/format'

/** The `ink-3` caption register a row's quiet facts (age, dash) are set in. */
export const ROW_META = 'text-cap text-ink-3'

const TYPE_ICONS: Record<DownloadType, IconName> = {
  [DownloadType.Movie]: 'film',
  [DownloadType.Show]: 'tv',
  [DownloadType.Video]: 'play',
}

/** Sentence case, in the app's own sans — a type is a word, not an identifier. */
const TYPE_LABELS: Record<DownloadType, string> = {
  [DownloadType.Movie]: 'Movie',
  [DownloadType.Show]: 'Show',
  [DownloadType.Video]: 'Video',
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

/** `film Movie` / `tv Show` / `play Video`: an icon and the type's name. */
export function ActivityTypeChip({ job }: ActivityTypeChipProps): JSX.Element {
  return (
    <MChip
      className="text-sm text-ink-2"
      icon={TYPE_ICONS[job.media.type]}
      label={TYPE_LABELS[job.media.type]}
    />
  )
}

export type ActivityStatusChipProps = {
  className?: string
  job: DownloadJob
}

/**
 * The status badge, carrying the breathing `live` dot whenever the machine is
 * actually moving the job along.
 *
 * ⚠️ The tint comes from `statusTone`, never from a mapping written here — so
 * `paused` is `warn` (a user intervened), `pending` is `warn` (waiting) and
 * `downloading` is `accent` (working). The word is `jobStatusLabel`'s, with
 * `Finishing up` for a download with nothing left to transfer, so every screen
 * names a status the same way.
 *
 * The dot is *not* suppressed when the socket is down. It states the job's
 * status, which is a server fact that does not stop being true because this tab
 * stopped hearing about it; the feed's own connection marker is what says the
 * page has gone stale, once, instead of nine rows each implying it.
 */
export function ActivityStatusChip({
  className,
  job,
}: ActivityStatusChipProps): JSX.Element {
  const text = jobChipLabel(
    job.status,
    jobHandoff(job.status, jobProgressPct(job)),
  )

  return isMoving(job) ? (
    <Badge className={className} tone={statusTone(job.status)} live>
      {text}
    </Badge>
  ) : (
    <Badge className={className} tone={statusTone(job.status)}>
      {text}
    </Badge>
  )
}

export type ActivityProgressProps = {
  job: DownloadJob
}

/**
 * The progress column: a bar plus the figure, or an em dash when there is none.
 *
 * A bar with every byte down but the work not done — a handoff to the importer,
 * or a video being converted — is the **settling** bar, not a full one: it says
 * "nearly" rather than "finished", which a full accent bar would not.
 *
 * ⚠️ The bar is `aria-hidden`. `Progress` emits `role="progressbar"` and its
 * `aria-value*` triple, and the figure beside it is the same fact as text, so
 * a screen reader would otherwise read this cell twice, once as a progress bar
 * at 64% and once as "64%".
 */
export function ActivityProgress({ job }: ActivityProgressProps): JSX.Element {
  const pct = jobProgressPct(job)

  if (pct === null) {
    return <span className={ROW_META}>{UNKNOWN_VALUE}</span>
  }

  return (
    <div className="flex w-40 max-w-full items-center gap-2">
      <SettlingProgress
        aria-hidden="true"
        className="flex-1"
        pct={pct}
        settling={jobHandoff(job.status, pct) !== null}
      />
      <span
        className={cns(
          'w-9 text-right text-cap tabular-nums',
          isMoving(job) ? 'text-accent-hi' : 'text-ink-3',
        )}
      >
        {pct}%
      </span>
    </div>
  )
}
