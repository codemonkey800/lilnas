import { ReactNode } from 'react'

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col flex-auto h-full w-full bg-black text-white">
      <nav className="p-3">
        <a
          className="text-2xl font-bold hover:text-purple-500 active:text-purple-500"
          href="/"
        >
          Download
        </a>
      </nav>

      {children}
    </div>
  )
}
