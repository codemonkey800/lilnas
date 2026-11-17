import { StatusDot as UiStatusDot, type StatusDotTone } from '@lilnas/ui'
import type { JSX } from 'react'

/**
 * The pre-redesign colour names, kept so existing call sites don't churn:
 * green is ok, yellow warn, red bad, gray idle.
 */
type Variant = 'green' | 'yellow' | 'red' | 'gray'

const TONES: Record<Variant, StatusDotTone> = {
  green: 'ok',
  yellow: 'warn',
  red: 'bad',
  gray: 'idle',
}

/** `@lilnas/ui`'s `StatusDot`, addressed by the old variant names. */
export function StatusDot({
  variant,
  pulse,
}: {
  variant: Variant
  pulse?: boolean
}): JSX.Element {
  return <UiStatusDot pulse={pulse} tone={TONES[variant]} />
}
