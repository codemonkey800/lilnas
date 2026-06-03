'use client'

import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import Button from '@mui/material/Button'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { startTransition, useEffect, useRef, useState } from 'react'

export type FailedSheetProps = {
  open: boolean
  mode: 'reps' | 'seconds'
  defaultValue: number
  isPending: boolean
  onConfirm: (value: number) => void
  onCancel: () => void
}

export function FailedSheet({
  open,
  mode,
  defaultValue,
  isPending,
  onConfirm,
  onCancel,
}: FailedSheetProps) {
  const [value, setValue] = useState(defaultValue)
  const minValue = mode === 'reps' ? 1 : 0

  // Reset to defaultValue on the false→true transition so a cancel-then-reopen
  // starts fresh. Wrapped in startTransition to satisfy set-state-in-effect.
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (open && !wasOpenRef.current)
      startTransition(() => setValue(defaultValue))
    wasOpenRef.current = open
  }, [open, defaultValue])

  const title =
    mode === 'reps' ? 'How many reps did you get?' : 'How long did you hold?'

  const unit = mode === 'reps' ? 'reps' : 'seconds'

  function decrement() {
    setValue(v => Math.max(minValue, v - 1))
  }

  function increment() {
    setValue(v => v + 1)
  }

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
          {title}
        </Typography>

        <div className="flex items-center justify-center gap-4">
          <IconButton
            aria-label={`Decrease ${unit}`}
            onClick={decrement}
            disabled={value <= minValue}
            className="!min-h-[44px] !min-w-[44px] !text-neutral-300 hover:!bg-neutral-800 disabled:!text-neutral-600"
          >
            <RemoveIcon />
          </IconButton>

          <TextField
            type="number"
            value={value}
            onChange={e => {
              const n = parseInt(e.target.value, 10)
              if (!Number.isNaN(n) && n >= minValue) setValue(n)
            }}
            inputProps={{
              min: minValue,
              className: '!text-center !text-2xl !font-bold',
            }}
            variant="outlined"
            size="small"
            className="!w-24"
          />

          <IconButton
            aria-label={`Increase ${unit}`}
            onClick={increment}
            className="!min-h-[44px] !min-w-[44px] !text-neutral-300 hover:!bg-neutral-800"
          >
            <AddIcon />
          </IconButton>
        </div>

        <Typography
          component="p"
          variant="caption"
          color="text.secondary"
          className="!text-center"
        >
          {unit}
        </Typography>

        <div className="flex gap-3">
          <Button
            variant="outlined"
            fullWidth
            onClick={onCancel}
            className="!border-neutral-700 !text-neutral-300 hover:!border-neutral-500"
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            fullWidth
            disabled={isPending}
            onClick={() => onConfirm(value)}
            className="!font-semibold"
          >
            Confirm
          </Button>
        </div>
      </div>
    </Drawer>
  )
}
