import { cns } from '@lilnas/utils/cns'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { type ButtonHTMLAttributes, forwardRef } from 'react'

const buttonVariants = cva(
  cns(
    'inline-flex items-center justify-center gap-2',
    'whitespace-nowrap rounded-md font-mono text-sm font-medium',
    'transition-all duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terminal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-carbon-900',
    'disabled:pointer-events-none disabled:opacity-40',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ),
  {
    variants: {
      variant: {
        default: cns(
          'bg-terminal text-carbon-950',
          'shadow-[0_0_12px_rgba(57,255,20,0.3)]',
          'hover:bg-phosphor-300 hover:shadow-[0_0_20px_rgba(57,255,20,0.5)]',
          'active:bg-phosphor-500',
        ),

        secondary: cns(
          'bg-carbon-700 text-carbon-100',
          'border border-carbon-500',
          'hover:bg-carbon-600 hover:text-carbon-50',
          'active:bg-carbon-600',
        ),

        outline: cns(
          'border border-terminal/40 text-terminal',
          'bg-transparent',
          'hover:bg-terminal/10 hover:border-terminal',
          'active:bg-terminal/15',
        ),

        ghost: cns(
          'text-carbon-200',
          'hover:bg-carbon-700 hover:text-carbon-50',
          'active:bg-carbon-600',
        ),

        destructive: cns(
          'bg-error text-carbon-50',
          'shadow-[0_0_12px_rgba(255,68,68,0.3)]',
          'hover:bg-error/90',
          'active:bg-error/80',
        ),

        link: cns(
          'text-terminal underline-offset-4',
          'hover:underline hover:text-phosphor-300',
        ),
      },

      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-6 text-base',
        icon: 'h-9 w-9',
      },
    },

    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cns(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)

Button.displayName = 'Button'

export { Button, buttonVariants }
