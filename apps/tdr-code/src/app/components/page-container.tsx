import { cns } from '@lilnas/utils/cns'
import { type ReactNode } from 'react'

const SPACING = {
  4: 'space-y-4',
  6: 'space-y-6',
  10: 'space-y-10',
} as const

export function PageContainer({
  title,
  children,
  spacing = 4,
}: {
  title?: string
  children: ReactNode
  spacing?: keyof typeof SPACING
}) {
  return (
    <div className={cns('mx-auto max-w-6xl', SPACING[spacing])}>
      {title && <h1 className="text-lg font-semibold text-white">{title}</h1>}
      {children}
    </div>
  )
}
