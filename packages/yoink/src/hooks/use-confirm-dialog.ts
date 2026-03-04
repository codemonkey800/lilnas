'use client'

import { useCallback, useState } from 'react'

interface ConfirmDialogState {
  open: boolean
  title: string
  description: string
  onConfirm: () => void
}

export function useConfirmDialog() {
  const [state, setState] = useState<ConfirmDialogState>({
    open: false,
    title: '',
    description: '',
    onConfirm: () => {},
  })

  const openDialog = useCallback((opts: Omit<ConfirmDialogState, 'open'>) => {
    setState({ ...opts, open: true })
  }, [])

  const closeDialog = useCallback(() => {
    setState(prev => ({ ...prev, open: false }))
  }, [])

  return { dialogState: state, openDialog, closeDialog }
}
