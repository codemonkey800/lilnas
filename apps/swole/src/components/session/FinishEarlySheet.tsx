'use client'

import Button from '@mui/material/Button'
import Drawer from '@mui/material/Drawer'
import Typography from '@mui/material/Typography'
import { useState } from 'react'

export type FinishEarlySheetProps = {
  open: boolean
  trainedCount: number
  totalSetsLogged: number
  isPending: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function FinishEarlySheet({
  open,
  trainedCount,
  totalSetsLogged,
  isPending,
  onConfirm,
  onCancel,
}: FinishEarlySheetProps) {
  const [navigating, setNavigating] = useState(false)

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onCancel}
      PaperProps={{
        className: 'rounded-t-2xl !bg-neutral-900 border-t border-neutral-800',
      }}
    >
      <div className="flex flex-col gap-6 px-5 pb-8 pt-5">
        <Typography component="h2" variant="h6" className="!font-bold">
          Finish early?
        </Typography>

        <div className="flex flex-col gap-1">
          <Typography component="p" variant="body2">
            {trainedCount} {trainedCount === 1 ? 'exercise' : 'exercises'} ·{' '}
            {totalSetsLogged} {totalSetsLogged === 1 ? 'set' : 'sets'} logged
          </Typography>
          <Typography component="p" variant="caption" color="text.secondary">
            Weighted exercises you trained advance; the rest stay put.
          </Typography>
        </div>

        <div className="flex gap-3">
          <Button
            variant="outlined"
            fullWidth
            onClick={onCancel}
            className="!border-neutral-700 !text-neutral-300 hover:!border-neutral-500"
          >
            Keep going
          </Button>
          <Button
            variant="contained"
            fullWidth
            disabled={navigating || isPending}
            onClick={() => {
              setNavigating(true)
              onConfirm()
            }}
            className="!font-semibold"
          >
            Finish session
          </Button>
        </div>
      </div>
    </Drawer>
  )
}
