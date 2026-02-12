'use client'

import { cns } from '@lilnas/utils/cns'
import Link from 'next/link'
import { useCallback, useState, useTransition } from 'react'
import { HiCheck, HiClock } from 'react-icons/hi2'

import { updateActionItemStatus } from 'src/app/(app)/check-ins/action-item.actions'
import type {
  ActionItemStatus,
  DashboardActionItem,
} from 'src/app/(app)/check-ins/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_CYCLE: Record<ActionItemStatus, ActionItemStatus> = {
  open: 'in_progress',
  in_progress: 'completed',
  completed: 'open',
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DashboardActionItemCardProps {
  item: DashboardActionItem
  userId: string
}

// ---------------------------------------------------------------------------
// DashboardActionItemCard
// ---------------------------------------------------------------------------

export function DashboardActionItemCard({
  item,
  userId,
}: DashboardActionItemCardProps) {
  const [isPending, startTransition] = useTransition()
  const [optimisticStatus, setOptimisticStatus] = useState(item.status)

  const ownerLabel =
    item.ownerType === 'both'
      ? 'Both'
      : item.ownerId === userId
        ? 'You'
        : (item.ownerDisplayName ?? 'Partner')

  const handleStatusToggle = useCallback(
    (e: React.MouseEvent) => {
      // Prevent the link navigation when clicking the status toggle
      e.preventDefault()
      e.stopPropagation()

      const nextStatus = STATUS_CYCLE[optimisticStatus]
      setOptimisticStatus(nextStatus)

      startTransition(async () => {
        const result = await updateActionItemStatus(item.id, nextStatus)
        if (!result.success) {
          setOptimisticStatus(item.status)
        }
      })
    },
    [optimisticStatus, item.id, item.status],
  )

  return (
    <Link
      href={`/check-ins/${item.checkInId}`}
      className={cns(
        'group flex items-center gap-3 rounded-md px-3 py-2.5',
        'bg-bg-surface border border-border-subtle',
        'transition-all duration-150 ease-smooth',
        'hover:border-primary-700 hover:shadow-glow',
        isPending && 'opacity-60',
      )}
    >
      {/* Status toggle button */}
      <button
        type="button"
        onClick={handleStatusToggle}
        disabled={isPending}
        aria-label={`Mark as ${STATUS_CYCLE[optimisticStatus]}`}
        className={cns(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
          'border transition-colors duration-150 ease-smooth',
          'focus-visible:shadow-focus',
          'disabled:opacity-40',
          optimisticStatus === 'open' && 'border-border bg-transparent',
          optimisticStatus === 'in_progress' &&
            'border-warning bg-warning/20 text-warning',
          optimisticStatus === 'completed' &&
            'border-success bg-success/20 text-success',
        )}
      >
        {optimisticStatus === 'in_progress' && <HiClock className="h-3 w-3" />}
        {optimisticStatus === 'completed' && <HiCheck className="h-3 w-3" />}
      </button>

      {/* Description + check-in title */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cns(
            'truncate text-sm',
            'group-hover:text-primary-300 transition-colors duration-150 ease-smooth',
            optimisticStatus === 'completed'
              ? 'text-text-muted line-through'
              : 'text-text',
          )}
        >
          {item.description}
        </span>
        <span className="truncate text-xs text-text-muted">
          {item.checkInTitle}
        </span>
      </div>

      {/* Owner badge */}
      <span
        className={cns(
          'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium',
          ownerLabel === 'Both'
            ? 'bg-primary-900 text-primary-300'
            : ownerLabel === 'You'
              ? 'bg-primary-900 text-primary-300'
              : 'bg-bg-overlay text-text-secondary',
        )}
      >
        {ownerLabel}
      </span>
    </Link>
  )
}
