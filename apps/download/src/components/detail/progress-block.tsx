import { cns } from '@lilnas/utils/cns'
import type { JSX, ReactNode } from 'react'

import { Card } from 'src/components/ui/card'
import { Bar } from 'src/components/ui/status'

export type ProgressBlockProps = {
  detail: ReactNode
  note: ReactNode
  pct: number
}

/**
 * `video-detail.pug`'s `progress` mixin, and `movie-detail.pug`'s
 * `startedFromRadarrFrame` card: an annotation and a percentage over a bar,
 * then one mono line under it. Shared by `JobLifecycle` and `MediaStatus`.
 *
 * ⚠️ The mixin's line reads `412 MB / 640 MB · 3.1 MB/s · ~2m left` and its
 * annotation reads `fragment 4 of 9`. Neither has anything behind it - see
 * `jobProgress` - so what lands here is upstream's queue status word and its
 * `hh:mm:ss` estimate, and either can be absent.
 *
 * The `Bar` keeps its `progressbar` role and gains a name; it is the numeric
 * percentage beside it that is `aria-hidden`, since that is the redundant
 * half. The alternative the primitive allows - `role="presentation"` on the
 * bar - would leave the bar unannounced *and* the number nameless.
 *
 * No directive: nothing here is interactive, so a server page can render it
 * through `MediaStatus` without dragging a client boundary along.
 */
export function ProgressBlock({
  detail,
  note,
  pct,
}: ProgressBlockProps): JSX.Element {
  return (
    <Card className={cns('max-w-[480px] p-4 sm:p-5')}>
      <div className={cns('flex flex-col gap-[14px] sm:gap-4')}>
        <div>
          <div
            className={cns('mb-2 flex items-center justify-between gap-2.5')}
          >
            <span className={cns('font-mono text-mono-sm text-ink-3')}>
              {note}
            </span>
            <span
              aria-hidden="true"
              className={cns('font-mono text-mono-sm tabular-nums text-uv-hi')}
            >
              {`${Math.round(pct)}%`}
            </span>
          </div>
          <Bar aria-label="Download progress" pct={pct} />
        </div>
        {detail ? (
          <p className={cns('font-mono text-mono-sm tabular-nums text-ink-3')}>
            {detail}
          </p>
        ) : null}
      </div>
    </Card>
  )
}
