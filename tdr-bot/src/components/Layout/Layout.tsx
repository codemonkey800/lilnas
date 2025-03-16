import { CssBaseline } from '@mui/material'
import { ReactNode } from 'react'

import { AppBar } from './AppBar'
import { AppDrawer } from './AppDrawer'
import { Main } from './Main'

export function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <CssBaseline />

      <Main>
        <AppDrawer />

        <div className="flex flex-auto flex-col md:translate-x-[256px] md:max-w-[calc(100%-256px)]">
          <AppBar />
          <div className="h-full max-h-[calc(100vh-64px)] translate-y-[64px] overflow-y-auto p-4">
            {children}
          </div>
        </div>
      </Main>
    </>
  )
}
