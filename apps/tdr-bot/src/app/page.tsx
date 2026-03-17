import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'

export default function RootPage() {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        p: 4,
      }}
    >
      <Typography variant="h4" component="h1">
        Hello World
      </Typography>
    </Box>
  )
}
