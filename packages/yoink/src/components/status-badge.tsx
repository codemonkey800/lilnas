import { Badge } from 'src/components/badge'

type AccountStatus = 'pending' | 'approved' | 'denied'

const statusConfig: Record<
  AccountStatus,
  { variant: 'warning' | 'success' | 'error'; label: string }
> = {
  pending: { variant: 'warning', label: 'Pending' },
  approved: { variant: 'success', label: 'Approved' },
  denied: { variant: 'error', label: 'Denied' },
}

interface StatusBadgeProps {
  status: AccountStatus
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const { variant, label } = statusConfig[status]
  return <Badge variant={variant}>{label}</Badge>
}
