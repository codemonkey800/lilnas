'use client'

import { Drawer } from '@mui/material'
import { useAtom } from 'jotai'
import { ReactNode } from 'react'

import { mobileDrawerOpen } from 'src/store/nav'

export function MobileAppDrawer({ children }: { children: ReactNode }) {
  const [open, setOpen] = useAtom(mobileDrawerOpen)

  return (
    <Drawer
      classes={{
        root: 'md:hidden',
        paper: 'w-[256px]',
      }}
      anchor="left"
      open={open}
      onClose={() => setOpen(false)}
    >
      {children}
    </Drawer>
  )
}
