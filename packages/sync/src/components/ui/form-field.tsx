import { ReactNode } from 'react'

export interface FormFieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: string | null
  children: ReactNode
}

export function FormField({ label, hint, error, children }: FormFieldProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-text-secondary">{label}</span>
      {hint && <span className="text-xs text-text-muted">{hint}</span>}
      {children}
      {error && <p className="text-sm text-error animate-fade-in">{error}</p>}
    </label>
  )
}
