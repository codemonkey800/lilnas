'use client'

import { cns } from '@lilnas/utils/cns'
import { useTheme } from 'next-themes'
import { Toaster as Sonner } from 'sonner'

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: cns(
            'group toast',
            'group-[.toaster]:bg-white',
            'group-[.toaster]:text-neutral-950',
            'group-[.toaster]:border-neutral-200',
            'group-[.toaster]:shadow-lg',
            'dark:group-[.toaster]:bg-neutral-950',
            'dark:group-[.toaster]:text-neutral-50',
            'dark:group-[.toaster]:border-neutral-800',
          ),

          description: cns(
            'group-[.toast]:text-neutral-500',
            'dark:group-[.toast]:text-neutral-400',
          ),

          actionButton: cns(
            'group-[.toast]:bg-neutral-900',
            'group-[.toast]:text-neutral-50',
            'dark:group-[.toast]:bg-neutral-50',
            'dark:group-[.toast]:text-neutral-900',
          ),

          cancelButton: cns(
            'group-[.toast]:bg-neutral-100',
            'group-[.toast]:text-neutral-500',
            'dark:group-[.toast]:bg-neutral-800',
            'dark:group-[.toast]:text-neutral-400',
          ),
        },
      }}
      {...props}
    />
  )
}
Toaster.displayName = 'Toaster'

export { Toaster }
