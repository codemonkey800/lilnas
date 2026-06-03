'use client'

import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import Button from '@mui/material/Button'
import { useRouter } from 'next/navigation'

export function BackLink() {
  const router = useRouter()

  const handleBack = () => router.push('/stats')

  return (
    <Button
      onClick={handleBack}
      startIcon={<ArrowBackIcon fontSize="small" />}
      variant="text"
      size="small"
      sx={{
        alignSelf: 'flex-start',
        textTransform: 'none',
        pl: 0,
        color: 'text.secondary',
        '&:hover': {
          color: 'text.primary',
          backgroundColor: 'transparent',
        },
      }}
    >
      Back
    </Button>
  )
}
