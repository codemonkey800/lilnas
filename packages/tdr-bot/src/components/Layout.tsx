import { ReactNode } from 'react'

export function Layout({ children }: { children: ReactNode }) {
  return <div className="w-full h-full">{children}</div>
}
