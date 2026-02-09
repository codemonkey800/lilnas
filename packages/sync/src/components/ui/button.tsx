import { cns } from '@lilnas/utils/cns'
import { ButtonHTMLAttributes, forwardRef } from 'react'

const variantStyles = {
  primary: cns('bg-primary text-text-inverse', 'hover:bg-primary-600'),

  secondary: cns(
    'border border-border bg-bg-surface text-text',
    'hover:bg-bg-overlay',
  ),

  ghost: cns('text-text-secondary', 'hover:bg-bg-overlay hover:text-text'),
  destructive: cns('text-error', 'hover:bg-error-muted hover:text-error'),
}

const sizeStyles = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-sm',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variantStyles
  size?: keyof typeof sizeStyles
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'primary',
      size = 'md',
      loading,
      disabled,
      className,
      children,
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cns(
          'inline-flex items-center justify-center gap-2 rounded-sm font-medium',
          'transition-colors duration-150 ease-smooth',
          'focus-visible:shadow-focus',
          'disabled:opacity-40',
          variantStyles[variant],
          sizeStyles[size],
          className,
        )}
        {...props}
      >
        {children}
      </button>
    )
  },
)
