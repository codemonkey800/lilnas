'use client'

import CloseIcon from '@mui/icons-material/Close'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'

export type DegradedStripProps = {
  onDismiss: () => void
}

export function DegradedStrip({ onDismiss }: DegradedStripProps) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
      <WarningAmberIcon className="!mt-0.5 !shrink-0 !text-base !text-amber-400" />
      <Typography
        component="p"
        variant="caption"
        className="!flex-1 !text-amber-200"
      >
        Some earlier sets couldn&apos;t be loaded — your position may be off.
      </Typography>
      <IconButton
        size="small"
        aria-label="Dismiss warning"
        onClick={onDismiss}
        className="!-mt-1 !-mr-1 !text-amber-400 hover:!bg-amber-500/20"
      >
        <CloseIcon fontSize="small" />
      </IconButton>
    </div>
  )
}
