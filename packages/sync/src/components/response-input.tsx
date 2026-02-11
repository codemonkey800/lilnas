'use client'

import { cns } from '@lilnas/utils/cns'
import {
  forwardRef,
  TextareaHTMLAttributes,
  useCallback,
  useEffect,
  useRef,
} from 'react'

const DEFAULT_MAX_LENGTH = 5000
const AUTO_SAVE_DELAY_MS = 1000

export interface ResponseInputProps
  extends Omit<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    'value' | 'onChange' | 'maxLength'
  > {
  value: string
  onValueChange: (value: string) => void
  onAutoSave?: (value: string) => void
  maxLength?: number
}

export const ResponseInput = forwardRef<
  HTMLTextAreaElement,
  ResponseInputProps
>(function ResponseInput(
  {
    value,
    onValueChange,
    onAutoSave,
    maxLength = DEFAULT_MAX_LENGTH,
    className,
    disabled,
    ...props
  },
  ref,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    return clearTimer
  }, [clearTimer])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      onValueChange(newValue)

      if (onAutoSave) {
        clearTimer()
        timerRef.current = setTimeout(() => {
          onAutoSave(newValue)
        }, AUTO_SAVE_DELAY_MS)
      }
    },
    [onValueChange, onAutoSave, clearTimer],
  )

  const isOverLimit = value.length >= maxLength

  return (
    <div className="flex flex-col gap-1">
      <textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        maxLength={maxLength}
        disabled={disabled}
        className={cns(
          'min-h-[120px] w-full resize-y rounded-sm border border-border',
          'bg-bg-raised px-3 py-2 text-sm text-text',
          'placeholder:text-text-muted',
          'transition-colors duration-150 ease-smooth',
          'focus:border-primary focus:outline-none focus-visible:shadow-focus',
          'disabled:opacity-40',
          className,
        )}
        {...props}
      />
      <span
        className={cns(
          'text-xs',
          isOverLimit ? 'text-error' : 'text-text-muted',
        )}
      >
        {value.length} / {maxLength}
      </span>
    </div>
  )
})
