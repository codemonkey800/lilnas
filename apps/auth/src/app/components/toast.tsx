'use client'

import type { ToastTone } from '@lilnas/ui'
import { useToast as useUiToast } from '@lilnas/ui'
import { useCallback, useMemo } from 'react'

// A thin wrapper over @lilnas/ui's `useToast()` that keeps the one-string
// call shape every page here already uses: `showToast('Access granted')`.
// The toast itself is drawn by the `ToastProvider` mounted once in
// layout.tsx, so there is no markup (and no `<Toast>` element) here anymore.
// An optional tone is the only addition — "Still blocked" is `bad`.
//
// Toasts confirm, they don't linger: every one dismisses itself after
// 2.2 seconds, `bad` included (the package default keeps a `bad` toast up
// until it's dismissed, which would stack up on a repeated "Check again").
const TOAST_VISIBLE_MS = 2200

export function useToast() {
  const { show } = useUiToast()

  const showToast = useCallback(
    (title: string, tone?: ToastTone) =>
      show({ title, tone, timeout: TOAST_VISIBLE_MS }),
    [show],
  )

  return useMemo(() => ({ showToast }), [showToast])
}
