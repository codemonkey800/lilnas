'use client'

import { useTheme } from '@mui/material'
import { ReactNode } from 'react'

export function Main({ children }: { children: ReactNode }) {
  const theme = useTheme()

  return (
    <div
      className="text-white flex h-full"
      style={{ background: theme.palette.background.default }}
    >
      {children}
    </div>
  )
}
