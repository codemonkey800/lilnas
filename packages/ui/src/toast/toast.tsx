'use client'

import { Toast as BaseToast } from '@base-ui/react/toast'
import { cns } from '@lilnas/utils/cns'
import type { JSX, ReactNode } from 'react'
import { useCallback, useMemo } from 'react'

/** `auth`'s existing constant: toasts confirm, they don't linger. */
export const TOAST_TIMEOUT_MS = 2200

export type ToastTone = 'ok' | 'warn' | 'bad' | 'accent'

export type ShowToastOptions = {
  title: string
  /** One truncated line under the title. */
  detail?: string
  tone?: ToastTone
  /** ms before it dismisses itself; 0 persists. Defaults to 2200 (`bad`: 0). */
  timeout?: number
}

const TOAST_TONES: Record<ToastTone, string> = {
  accent: 'before:bg-accent',
  ok: 'before:bg-ok',
  warn: 'before:bg-warn',
  bad: 'before:bg-bad',
}

function ToastList(): JSX.Element {
  const { toasts, close } = BaseToast.useToastManager()

  return (
    <>
      {toasts.map(toast => (
        <BaseToast.Root
          className={cns(
            'relative flex items-start gap-3 rounded-lg border border-line-loud bg-surface',
            'py-2.5 pr-3.5 pl-5 shadow-lift animate-rise',
            // The tone is a straight inset bar, not a border: a border-l on a
            // rounded box bends round the corners into a crescent.
            'before:absolute before:inset-y-2.5 before:left-2 before:w-[3px] before:rounded-full',
            // The exit is the entry played backwards: fade and drop 6px.
            'data-[ending-style]:animate-[rise_200ms_var(--ease-standard)_reverse_both]',
            TOAST_TONES[(toast.type as ToastTone | undefined) ?? 'accent'],
          )}
          key={toast.id}
          toast={toast}
        >
          <div className="min-w-0 flex-1">
            <BaseToast.Title className="truncate text-[13.5px] font-medium text-ink" />
            <BaseToast.Description className="truncate text-sm text-ink-3" />
          </div>
          <button
            aria-label="Dismiss"
            className={cns(
              '-my-0.5 -mr-1.5 flex size-6 shrink-0 items-center justify-center rounded-md',
              'text-ink-3 transition-press hover:bg-surface-2 hover:text-ink',
            )}
            onClick={() => close(toast.id)}
            type="button"
          >
            <svg
              aria-hidden="true"
              fill="none"
              height="14"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.75"
              viewBox="0 0 24 24"
              width="14"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </BaseToast.Root>
      ))}
    </>
  )
}

/**
 * Mount once near the root. Owns the bottom-centre viewport; hovering or
 * focusing it pauses every timer.
 */
export function ToastProvider({
  children,
}: {
  children?: ReactNode
}): JSX.Element {
  return (
    <BaseToast.Provider timeout={TOAST_TIMEOUT_MS}>
      {children}
      <BaseToast.Portal>
        <BaseToast.Viewport
          aria-label="Notifications"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 z-50 flex w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2"
          role="status"
        >
          <ToastList />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  )
}

/** Fire a toast. Must be called under a `ToastProvider`. */
export function useToast(): { show: (opts: ShowToastOptions) => void } {
  const { add } = BaseToast.useToastManager()

  const show = useCallback(
    ({ title, detail, tone = 'accent', timeout }: ShowToastOptions) => {
      add({
        title,
        description: detail,
        type: tone,
        // Base UI treats a 0 timeout as "stay until dismissed".
        timeout: timeout ?? (tone === 'bad' ? 0 : TOAST_TIMEOUT_MS),
      })
    },
    [add],
  )

  return useMemo(() => ({ show }), [show])
}
