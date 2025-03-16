'use client'

import { Close, Menu } from '@mui/icons-material'
import { IconButton } from '@mui/material'
import { useAtom } from 'jotai'

import { mobileDrawerOpen } from 'src/store/nav'

export function AppBarDrawerButton() {
  const [open, setOpen] = useAtom(mobileDrawerOpen)
  const Icon = open ? Close : Menu

  return (
    <div className="md:hidden">
      <IconButton onClick={() => setOpen((prev) => !prev)}>
        <Icon />
      </IconButton>
    </div>
  )
}
