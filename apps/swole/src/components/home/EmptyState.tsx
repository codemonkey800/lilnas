import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import Link from 'next/link'

type EmptyStateProps = {
  archivedCount?: number
}

export function EmptyState({ archivedCount = 0 }: EmptyStateProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <Typography component="h2" variant="h5" className="!font-bold">
        No routines yet
      </Typography>
      <Typography component="p" variant="body2" color="text.secondary">
        Create your first routine to start tracking workouts.
      </Typography>
      <Button href="/routines/new" variant="contained" size="large">
        Create your first routine
      </Button>
      {archivedCount > 0 && (
        <Link
          href="/routines/archived"
          className="text-sm text-[var(--mui-palette-text-secondary)] underline-offset-2 hover:underline"
        >
          Archived routines ({archivedCount})
        </Link>
      )}
    </div>
  )
}
