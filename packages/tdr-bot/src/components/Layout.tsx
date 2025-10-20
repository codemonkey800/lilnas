import { ReactNode } from 'react'

import { AppBar } from './AppBar'

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="w-full h-full flex flex-col">
      <AppBar />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
