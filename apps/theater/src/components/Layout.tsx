import { ReactNode } from 'react'

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col flex-auto h-full w-full bg-black text-white">
      {children}
    </div>
  )
}
