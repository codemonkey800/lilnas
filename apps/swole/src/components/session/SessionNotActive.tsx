import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'

export function SessionNotActive() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <Typography component="h2" variant="h5" className="!font-bold">
        Session not active
      </Typography>
      <Typography component="p" variant="body2" color="text.secondary">
        This session isn&apos;t active — it may be finished or no longer exist.
      </Typography>
      <Button href="/" variant="contained" size="large">
        Back to home
      </Button>
    </div>
  )
}
