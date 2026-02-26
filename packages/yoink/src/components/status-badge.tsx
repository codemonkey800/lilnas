import Chip from '@mui/material/Chip'

type AccountStatus = 'pending' | 'approved'

const statusConfig: Record<
  AccountStatus,
  { color: 'warning' | 'success'; label: string }
> = {
  pending: { color: 'warning', label: 'Pending' },
  approved: { color: 'success', label: 'Approved' },
}

interface StatusBadgeProps {
  status: AccountStatus
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const { color, label } = statusConfig[status]
  return <Chip label={label} color={color} size="small" variant="outlined" />
}
