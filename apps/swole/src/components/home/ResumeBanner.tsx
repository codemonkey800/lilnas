import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'

import type { Exercise, NextTarget } from 'src/core/session-machine'
import { formatBannerSubtitle } from 'src/lib/format'

export type ResumeBannerProps = {
  sessionId: number
  routineName: string
  target: NextTarget | null
  exercise: Exercise | null
  // When true, the upstream hydration skipped one or more set logs. The
  // banner's "set N/total" can no longer be trusted; surface a degraded line
  // instead of pretending the position is exact.
  degraded?: boolean
}

export function ResumeBanner({
  sessionId,
  routineName,
  target,
  exercise,
  degraded = false,
}: ResumeBannerProps) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-orange-500/30 bg-gradient-to-br from-orange-500/15 via-orange-500/5 to-transparent p-5 shadow-lg shadow-orange-500/5">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-orange-500"
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wider text-orange-400/90">
            In progress
          </span>
          <Typography
            component="h2"
            variant="h6"
            className="!font-bold !leading-tight"
          >
            Resume {routineName}
          </Typography>
          {degraded ? (
            <Typography
              component="p"
              variant="body2"
              color="text.secondary"
              className="!italic"
            >
              Session has skipped logs — open to verify position.
            </Typography>
          ) : target && exercise ? (
            <Typography
              component="p"
              variant="body2"
              className="!text-neutral-300"
            >
              {formatBannerSubtitle(exercise, target)}
            </Typography>
          ) : null}
        </div>
        <Button
          href={`/session/${sessionId}`}
          variant="contained"
          size="large"
          startIcon={<PlayArrowIcon />}
          className="!shrink-0 !font-semibold !shadow-md"
        >
          Resume
        </Button>
      </div>
    </div>
  )
}
