'use client'

import { cns } from '@lilnas/utils/cns'
import { useCallback, useEffect, useRef } from 'react'

export interface DialogProps {
  open: boolean
  onClose: () => void
  loading?: boolean
  className?: string
  children: React.ReactNode
  'aria-labelledby'?: string
}

export function Dialog({
  open,
  onClose,
  loading,
  className,
  children,
  'aria-labelledby': ariaLabelledBy,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  // Open as modal on mount; native showModal() provides focus trap + scroll lock
  useEffect(() => {
    if (open) {
      dialogRef.current?.showModal()
    } else {
      dialogRef.current?.close()
    }
  }, [open])

  // Wire up native close / cancel events
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    function handleClose() {
      onClose()
    }

    function handleCancel(e: Event) {
      if (loading) e.preventDefault()
    }

    dialog.addEventListener('close', handleClose)
    dialog.addEventListener('cancel', handleCancel)

    return () => {
      dialog.removeEventListener('close', handleClose)
      dialog.removeEventListener('cancel', handleCancel)
    }
  }, [onClose, loading])

  // Close on backdrop click (click outside the dialog box)
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (loading) return
      const rect = e.currentTarget.getBoundingClientRect()

      const clickedOutside =
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom

      if (clickedOutside) {
        e.currentTarget.close()
      }
    },
    [loading],
  )

  return (
    <dialog
      ref={dialogRef}
      onClick={handleBackdropClick}
      className={cns(
        'm-auto w-full max-w-sm border-none',
        'rounded-lg bg-bg-overlay p-6 shadow-lg',
        'animate-scale-in',
        className,
      )}
      aria-labelledby={ariaLabelledBy}
    >
      {children}
    </dialog>
  )
}
