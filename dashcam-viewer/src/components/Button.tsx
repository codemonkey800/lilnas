import { ReactNode } from 'react'

import { cns } from 'src/utils/cns'

export function Button({
  children,
  onClick,
}: {
  children: ReactNode
  onClick(): void
}) {
  return (
    <button
      className={cns(
        'px-1 py-0.5 rounded',
        'bg-purple-500 hover:bg-purple-700',
        'text-white font-medium',
      )}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
