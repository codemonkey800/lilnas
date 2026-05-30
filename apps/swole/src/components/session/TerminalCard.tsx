'use client'

import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'

import type { SessionSummary } from 'src/lib/runner'

export type TerminalCardProps = {
  summary: SessionSummary
  onFinish: () => void
}

export function TerminalCard({ summary, onFinish }: TerminalCardProps) {
  return (
    <div className="flex flex-col items-center gap-6 rounded-xl border border-orange-500/30 bg-gradient-to-br from-orange-500/10 via-orange-500/5 to-transparent p-8 text-center shadow-md">
      <CheckCircleOutlineIcon className="!text-5xl !text-orange-400" />

      <div className="flex flex-col gap-1">
        <Typography component="h2" variant="h5" className="!font-bold">
          All sets done!
        </Typography>
        <Typography component="p" variant="body2" color="text.secondary">
          {summary.exerciseCount}{' '}
          {summary.exerciseCount === 1 ? 'exercise' : 'exercises'} ·{' '}
          {summary.totalSetsLogged}{' '}
          {summary.totalSetsLogged === 1 ? 'set' : 'sets'}
        </Typography>
      </div>

      <Button
        variant="contained"
        size="large"
        onClick={onFinish}
        className="!font-semibold !px-8"
      >
        Finish session →
      </Button>
    </div>
  )
}
