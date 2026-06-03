import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <Typography component="h1" variant="h5" className="!font-bold">
        Routine not found
      </Typography>
      <Typography component="p" variant="body2" color="text.secondary">
        This routine may have been deleted or the link is incorrect.
      </Typography>
      <Button href="/" variant="outlined">
        Back to home
      </Button>
    </div>
  )
}
