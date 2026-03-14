'use client'

import AccessTimeIcon from '@mui/icons-material/AccessTime'
import Chip from '@mui/material/Chip'
import { useOptimistic, useTransition } from 'react'

import { approveUser, removeUser } from 'src/app/(library)/admin/actions'
import { EmptyState } from 'src/components/empty-state'
import { type AdminUser, UserCard } from 'src/components/user-card'

type OptimisticAction =
  | { type: 'approve'; userId: string }
  | { type: 'remove'; userId: string }

function reduceUsers(
  users: AdminUser[],
  action: OptimisticAction,
): AdminUser[] {
  return users.map(u => {
    if (u.id !== action.userId) return u
    return {
      ...u,
      status: action.type === 'approve' ? 'approved' : 'pending',
    } satisfies AdminUser
  })
}

interface AdminContentProps {
  users: AdminUser[]
  currentUserId: string
}

export function AdminContent({
  users: serverUsers,
  currentUserId,
}: AdminContentProps) {
  const [users, addOptimistic] = useOptimistic(serverUsers, reduceUsers)
  const [, startTransition] = useTransition()

  const pendingUsers = users.filter(u => u.status === 'pending')
  const approvedUsers = users.filter(u => u.status === 'approved')

  function handleApprove(userId: string) {
    startTransition(async () => {
      addOptimistic({ type: 'approve', userId })
      await approveUser(userId)
    })
  }

  function handleRemove(userId: string) {
    startTransition(async () => {
      addOptimistic({ type: 'remove', userId })
      await removeUser(userId)
    })
  }

  return (
    <div className="space-y-10">
      <section>
        <div className="mb-4 flex items-center gap-3">
          <h2 className="text-2xl">Pending Requests</h2>
          <Chip
            label={pendingUsers.length}
            size="small"
            color="warning"
            variant="outlined"
          />
        </div>

        {pendingUsers.length === 0 ? (
          <EmptyState
            icon={<AccessTimeIcon />}
            title="No pending requests"
            description="All access requests have been handled."
          />
        ) : (
          <div className="space-y-2">
            {pendingUsers.map(user => (
              <UserCard
                key={user.id}
                user={user}
                onApprove={handleApprove}
                onRemove={user.id === currentUserId ? undefined : handleRemove}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-4 flex items-center gap-3">
          <h2 className="text-2xl">Approved Users</h2>
          <Chip
            label={approvedUsers.length}
            size="small"
            color="success"
            variant="outlined"
          />
        </div>

        {approvedUsers.length === 0 ? (
          <EmptyState
            icon={<AccessTimeIcon />}
            title="No approved users"
            description="Approve pending requests to see users here."
          />
        ) : (
          <div className="space-y-2">
            {approvedUsers.map(user => (
              <UserCard
                key={user.id}
                user={user}
                onRemove={user.id === currentUserId ? undefined : handleRemove}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
