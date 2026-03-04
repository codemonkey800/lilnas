'use client'

import { cns } from '@lilnas/utils/cns'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import Avatar from '@mui/material/Avatar'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'

import { StatusBadge } from 'src/components/status-badge'
import dayjs from 'src/lib/dayjs'

export interface AdminUser {
  id: string
  name: string | null
  email: string | null
  image: string | null
  status: 'pending' | 'approved' | 'denied'
  emailVerified: Date | null
}

function getInitials(name: string | null): string {
  if (!name) return '?'
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase()
}

interface UserCardProps {
  user: AdminUser
  onApprove?: (userId: string) => void
  onRemove?: (userId: string) => void
}

export function UserCard({ user, onApprove, onRemove }: UserCardProps) {
  const showApprove = onApprove && user.status !== 'approved'
  const showRemove = onRemove && user.status === 'approved'

  return (
    <div
      className={cns(
        'flex items-center gap-4 rounded-md border border-carbon-500 bg-carbon-800 px-4 py-3',
        'transition-colors hover:border-carbon-400',
      )}
    >
      <Avatar src={user.image ?? undefined} alt={user.name ?? 'User'}>
        {getInitials(user.name)}
      </Avatar>

      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-sm font-medium text-carbon-100">
          {user.name ?? 'Unknown'}
        </p>
        <p className="truncate text-xs text-carbon-400">{user.email}</p>
      </div>

      {user.emailVerified && (
        <span className="hidden text-xs text-carbon-400 sm:block">
          {dayjs(user.emailVerified).fromNow()}
        </span>
      )}

      <StatusBadge status={user.status} />

      {(showApprove || showRemove) && (
        <div className="flex gap-1">
          {showApprove && (
            <Tooltip title="Approve">
              <IconButton
                size="small"
                onClick={() => onApprove(user.id)}
                sx={{
                  color: 'success.main',
                  '&:hover': { backgroundColor: 'rgba(57, 255, 20, 0.1)' },
                }}
              >
                <CheckIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {showRemove && (
            <Tooltip title="Remove">
              <IconButton
                size="small"
                onClick={() => onRemove(user.id)}
                sx={{
                  color: 'error.main',
                  '&:hover': { backgroundColor: 'rgba(255, 68, 68, 0.1)' },
                }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  )
}
