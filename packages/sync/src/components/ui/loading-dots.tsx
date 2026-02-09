import { cns } from '@lilnas/utils/cns'

export interface LoadingDotsProps {
  className?: string
}

export function LoadingDots({ className }: LoadingDotsProps) {
  return (
    <div className={cns('flex gap-1.5', className)}>
      <span
        className="h-2 w-2 animate-bounce rounded-full bg-primary-500"
        style={{ animationDelay: '0ms' }}
      />

      <span
        className="h-2 w-2 animate-bounce rounded-full bg-primary-500"
        style={{ animationDelay: '150ms' }}
      />

      <span
        className="h-2 w-2 animate-bounce rounded-full bg-primary-500"
        style={{ animationDelay: '300ms' }}
      />
    </div>
  )
}
