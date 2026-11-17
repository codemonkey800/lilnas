import { Card } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { JSX, ReactNode } from 'react'

import { SettlingProgress } from 'src/components/ui/settling-progress'

export type ProgressBlockProps = {
  detail: ReactNode
  note: ReactNode
  pct: number
  /** Passed to `Bar` - the bytes are down, the title is not in the library. */
  settling?: boolean
}

/**
 * `video-detail.pug`'s `progress` mixin, and `movie-detail.pug`'s
 * `startedFromRadarrFrame` card: an annotation and a percentage over a bar,
 * then one mono line under it. Drawn by `MediaStatus`.
 *
 * ⚠️ Only a movie or show reaches this block, so what lands here is
 * upstream's queue status word and its `hh:mm:ss` estimate, and either can be
 * absent. The mixin's `fragment 4 of 9` and `412 MB / 640 MB · 3.1 MB/s · ~2m
 * left` are a video's, and a video's progress is its job's - `AttemptList`'s
 * in-flight card draws those, off `jobProgress`.
 *
 * The `Bar` keeps its `progressbar` role and gains a name; it is the numeric
 * percentage beside it that is `aria-hidden`, since that is the redundant
 * half. The alternative the primitive allows - `role="presentation"` on the
 * bar - would leave the bar unannounced *and* the number nameless.
 *
 * While `settling`, the bar sweeps and announces `note` along with its
 * value, so "100%" is never read out alone over work that is still going.
 *
 * No directive: nothing here is interactive, so a server page can render it
 * through `MediaStatus` without dragging a client boundary along.
 */
export function ProgressBlock({
  detail,
  note,
  pct,
  settling = false,
}: ProgressBlockProps): JSX.Element {
  return (
    <Card
      className={cns('flex max-w-[480px] flex-col gap-3 border-accent-dim')}
    >
      <div className={cns('flex items-center justify-between gap-2.5')}>
        <span className={cns('text-cap text-ink-3')}>{note}</span>
        <span
          aria-hidden="true"
          className={cns('text-sm font-medium text-accent-hi tabular-nums')}
        >
          {`${Math.round(pct)}%`}
        </span>
      </div>
      <SettlingProgress
        aria-label="Download progress"
        aria-valuetext={
          settling && typeof note === 'string'
            ? `${Math.round(pct)}%, ${note}`
            : undefined
        }
        pct={pct}
        settling={settling}
      />
      {detail ? (
        <p className={cns('text-cap text-ink-3 tabular-nums')}>{detail}</p>
      ) : null}
    </Card>
  )
}
