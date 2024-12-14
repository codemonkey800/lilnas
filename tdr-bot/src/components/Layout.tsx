import { ReactNode } from 'react'

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-auto flex-col bg-gray-900 text-white p-4">
      {children}
    </div>
  )
}
