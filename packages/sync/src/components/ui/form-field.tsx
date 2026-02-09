import { ReactNode } from 'react'

export interface FormFieldProps {
  label: ReactNode
  error?: string | null
  children: ReactNode
}

export function FormField({ label, error, children }: FormFieldProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-text-secondary">{label}</span>
      {children}
      {error && <p className="text-sm text-error animate-fade-in">{error}</p>}
    </label>
  )
}
