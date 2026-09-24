import { cns } from '@lilnas/utils/cns'
import type { Media, MediaState } from '@lilnas/utils/download/types'
import { mediaState } from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react'

import { FINISHING_LABEL, handoffDetail } from 'src/components/detail/job-state'
import {
  mediaHandoff,
  mediaProgress,
  mediaStateIsLive,
  mediaStateLabel,
} from 'src/components/detail/media-state'
import { ProgressBlock } from 'src/components/detail/progress-block'
import { Chip } from 'src/components/ui/chip'
import { Dot } from 'src/components/ui/status'
import { mediaStateTone } from 'src/lib/format'

export type MediaStatusProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> & {
  /**
   * The line beside the chip. Defaults to the media's own `stateReason`,
   * which the server only sets for `needs_attention`.
   */
  explain?: ReactNode
  /** The title whose state this is — a movie, a show or a video. */
  media: Media
  /**
   * Replaces the mono line under the bar — e.g. `S3E7 · 610 MB / 1.7 GB`.
   * Defaults to the queue's own `~hh:mm:ss left` when it reports one.
   */
  progressDetail?: ReactNode
  /** Replaces the queue snapshot's percentage — e.g. a season's own. */
  progressPct?: number
  /**
   * Overrides `mediaState(media)` for a narrower (a season, an episode) or
   * wider (a series rollup) scope than the media's own. The label still reads
   * in `media.type`'s wording.
   */
  scopeState?: MediaState
}

/**
 * Where a title stands — the media-state chip, why when the server says why,
 * and the download's progress while there is any to show.
 *
 * Ports `movie-detail.pug`'s `mediaChip` and `startedFromRadarrFrame` card
 * (and the same pair on the show and video pages). Everything here reads off
 * the **media**, never a job: the motivating bug was a playable *Cars* reading
 * `failed` because a restart failed its newest job, so this component takes
 * no job at all and a failed attempt cannot reach it. The attempts are
 * `AttemptList`'s, drawn separately under it.
 *
 * The progress block draws whenever the queue snapshot (or the page's own
 * `progressPct`) says there is progress — with or without a job behind it,
 * which is exactly the "Started from Radarr" frame: a grab from Radarr's own
 * UI shows a chip and a bar here and no attempt anywhere.
 *
 * Once every byte is down (see `Handoff`), the chip and the bar's note say
 * so - `finishing up`, then `importing…` - the bar settles instead of sitting
 * frozen at 100%, and the queue's spent `~00:00:00 left` gives way to who is
 * doing what now.
 *
 * No directive and no hooks, so a server page can render it directly.
 */
export function MediaStatus({
  className,
  explain,
  media,
  progressDetail,
  progressPct,
  scopeState,
  ...props
}: MediaStatusProps): JSX.Element {
  const state = scopeState ?? mediaState(media)
  const note = explain ?? media.stateReason ?? null

  const derived = mediaProgress(media)
  const pct = progressPct ?? derived?.pct ?? null
  const handoff = mediaHandoff(state, pct)
  const label =
    handoff === 'finishing'
      ? FINISHING_LABEL
      : mediaStateLabel(state, media.type)
  const detail =
    progressDetail ??
    (handoff
      ? handoffDetail(handoff, media.type)
      : derived?.timeLeft
        ? `~${derived.timeLeft} left`
        : null)
  // Radarr's own word reads `downloading` at 100% and `completed` while it
  // imports; neither is what is happening, so a handoff names itself.
  const progressNote = handoff ? label : (derived?.note ?? null)

  return (
    <div
      {...props}
      className={cns('flex flex-col gap-[14px]', className)}
      data-state={state}
    >
      <div className={cns('flex flex-wrap items-center gap-2.5')}>
        <Chip className={cns('w-fit')} tone={mediaStateTone(state)}>
          {mediaStateIsLive(state) ? <Dot tone="live" /> : null}
          {label}
        </Chip>
        {note ? (
          <span className={cns('min-w-0 flex-1 text-sm text-ink-3')}>
            {note}
          </span>
        ) : null}
      </div>
      {pct === null ? null : (
        <ProgressBlock
          detail={detail}
          note={progressNote}
          pct={pct}
          settling={handoff !== null}
        />
      )}
    </div>
  )
}
