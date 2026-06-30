import { cns } from '@lilnas/utils/cns'

type Variant = 'green' | 'yellow' | 'red' | 'gray'

export function StatusDot({ variant }: { variant: Variant }) {
  return (
    <span
      className={cns(
        'inline-block h-2.5 w-2.5 rounded-full',
        variant === 'green' && 'bg-green-400',
        variant === 'yellow' && 'bg-yellow-400',
        variant === 'red' && 'bg-red-400',
        variant === 'gray' && 'bg-gray-400',
      )}
    />
  )
}
