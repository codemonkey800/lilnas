import type { BadgeTone } from '@lilnas/ui'
import { Badge } from '@lilnas/ui'

// The account-status badge on the home page: one tone and one label per
// status. `none` is "signed in with nothing granted or asked for".
export type AccountStatus = 'admin' | 'blocked' | 'granted' | 'pending' | 'none'

const STATUS_BADGES: Record<AccountStatus, { tone: BadgeTone; label: string }> =
  {
    admin: { tone: 'accent', label: 'Admin' },
    granted: { tone: 'ok', label: 'Granted' },
    pending: { tone: 'warn', label: 'Pending' },
    blocked: { tone: 'bad', label: 'Blocked' },
    none: { tone: 'mute', label: 'No access' },
  }

export function StatusBadge({ status }: { status: AccountStatus }) {
  const { tone, label } = STATUS_BADGES[status]

  return <Badge tone={tone}>{label}</Badge>
}
