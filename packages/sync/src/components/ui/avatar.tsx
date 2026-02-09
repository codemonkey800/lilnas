import { cns } from '@lilnas/utils/cns'
import { forwardRef, HTMLAttributes } from 'react'

const sizeStyles = {
  sm: 'h-10 w-10 text-sm',
  md: 'h-14 w-14 text-xl',
  lg: 'h-16 w-16 text-2xl',
}

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  initial: string
  size?: keyof typeof sizeStyles
}

export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(function Avatar(
  { initial, size = 'md', className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cns(
        'flex items-center justify-center rounded-full',
        'bg-primary-900 font-bold text-primary-300',
        sizeStyles[size],
        className,
      )}
      {...props}
    >
      {initial.charAt(0).toUpperCase()}
    </div>
  )
})
