'use client'

import { cns } from '@lilnas/utils/cns'
import { useCallback, useState, useTransition } from 'react'
import { HiCheck, HiClock, HiTrash } from 'react-icons/hi2'

import {
  deleteActionItem,
  updateActionItemStatus,
} from 'src/app/(app)/check-ins/actions'
import type {
  ActionItem,
  ActionItemStatus,
  CheckInStatus,
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

export interface ActionItemCardProps {
  item: ActionItem
  userId: string
  checkInStatus: CheckInStatus
}

// ---------------------------------------------------------------------------
// ActionItemCard
// ---------------------------------------------------------------------------

export function ActionItemCard({
  item,
  userId,
  checkInStatus,
}: ActionItemCardProps) {
  const [isPending, startTransition] = useTransition()
  const [optimisticStatus, setOptimisticStatus] = useState(item.status)

  const canDelete = checkInStatus === 'in_progress'

  const ownerLabel =
    item.ownerType === 'both'
      ? 'Both'
      : item.ownerId === userId
        ? 'You'
        : (item.ownerDisplayName ?? 'Partner')

  const handleStatusToggle = useCallback(() => {
    const nextStatus = STATUS_CYCLE[optimisticStatus]
    setOptimisticStatus(nextStatus)

    startTransition(async () => {
      const result = await updateActionItemStatus(item.id, nextStatus)
      if (!result.success) {
        // Revert on failure
        setOptimisticStatus(item.status)
      }
    })
  }, [optimisticStatus, item.id, item.status])

  const handleDelete = useCallback(() => {
    startTransition(async () => {
      await deleteActionItem(item.id)
    })
  }, [item.id])

  return (
    <div
      className={cns(
        'flex items-center gap-3 rounded-sm px-3 py-2',
        'bg-bg-surface border border-border-subtle',
        'transition-opacity duration-150',
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

      {/* Description */}
      <span
        className={cns(
          'flex-1 text-sm',
          optimisticStatus === 'completed'
            ? 'text-text-muted line-through'
            : 'text-text',
        )}
      >
        {item.description}
      </span>

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

      {/* Delete button (only in progress view) */}
      {canDelete && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending}
          aria-label="Delete action item"
          className={cns(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-sm',
            'text-text-muted',
            'transition-colors duration-150 ease-smooth',
            'hover:bg-error-muted hover:text-error',
            'focus-visible:shadow-focus',
            'disabled:opacity-40',
          )}
        >
          <HiTrash className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
