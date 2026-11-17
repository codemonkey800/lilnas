import { Badge, type BadgeTone } from '@lilnas/ui'
import type { JSX } from 'react'

export type ChipStatus =
  | 'configured'
  | 'decrypt_failed'
  | 'linked'
  | 'not-linked'
  | 'not-configured'
  | 'decrypt-failed'

const CHIP: Record<ChipStatus, { tone: BadgeTone; label: string }> = {
  configured: { tone: 'ok', label: 'Configured' },
  decrypt_failed: { tone: 'bad', label: 'Decrypt failed' },
  linked: { tone: 'ok', label: 'Linked' },
  'not-linked': { tone: 'mute', label: 'Not linked' },
  'not-configured': { tone: 'mute', label: 'Not configured' },
  'decrypt-failed': { tone: 'bad', label: 'Decrypt failed' },
}

/**
 * One badge for GitHub and SSH alike, so every status on the page reads the
 * same: green is good, red is broken, quiet is absent.
 */
export function StatusBadge({ status }: { status: ChipStatus }): JSX.Element {
  const { tone, label } = CHIP[status]
  return <Badge tone={tone}>{label}</Badge>
}
