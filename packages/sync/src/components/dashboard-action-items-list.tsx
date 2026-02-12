'use client'

import { cns } from '@lilnas/utils/cns'
import { useMemo, useState } from 'react'
import { HiClipboardDocumentCheck } from 'react-icons/hi2'

import type {
  DashboardActionItem,
  DashboardActionItemOwnerFilter,
  DashboardActionItemStatusFilter,
} from 'src/app/(app)/check-ins/types'

import { DashboardActionItemCard } from './dashboard-action-item-card'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OWNER_FILTERS: {
  value: DashboardActionItemOwnerFilter
  label: string
}[] = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'partner', label: "Partner's" },
  { value: 'shared', label: 'Shared' },
]

const STATUS_FILTERS: {
  value: DashboardActionItemStatusFilter
  label: string
}[] = [
  { value: 'open', label: 'Open' },
  { value: 'completed', label: 'Completed' },
]

// ---------------------------------------------------------------------------
// Empty state messages per owner filter
// ---------------------------------------------------------------------------

function getEmptyMessage(
  owner: DashboardActionItemOwnerFilter,
  status: DashboardActionItemStatusFilter,
): string {
  const statusLabel = status === 'open' ? 'open' : 'completed'

  switch (owner) {
    case 'mine':
      return `No ${statusLabel} action items assigned to you`
    case 'partner':
      return `No ${statusLabel} action items assigned to your partner`
    case 'shared':
      return `No ${statusLabel} shared action items`
    default:
      return `No ${statusLabel} action items`
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DashboardActionItemsListProps {
  items: DashboardActionItem[]
  userId: string
}

// ---------------------------------------------------------------------------
// DashboardActionItemsList
// ---------------------------------------------------------------------------

export function DashboardActionItemsList({
  items,
  userId,
}: DashboardActionItemsListProps) {
  const [ownerFilter, setOwnerFilter] =
    useState<DashboardActionItemOwnerFilter>('all')
  const [statusFilter, setStatusFilter] =
    useState<DashboardActionItemStatusFilter>('open')

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      // Status filter
      if (statusFilter === 'open') {
        if (item.status === 'completed') return false
      } else {
        if (item.status !== 'completed') return false
      }

      // Owner filter
      switch (ownerFilter) {
        case 'mine':
          return item.ownerType === 'individual' && item.ownerId === userId
        case 'partner':
          return item.ownerType === 'individual' && item.ownerId !== userId
        case 'shared':
          return item.ownerType === 'both'
        default:
          return true
      }
    })
  }, [items, ownerFilter, statusFilter, userId])

  return (
    <div className="flex flex-col gap-3">
      {/* Filter bars */}
      <div className="flex flex-col gap-2">
        {/* Owner filter pills */}
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Filter by owner"
        >
          {OWNER_FILTERS.map(filter => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setOwnerFilter(filter.value)}
              aria-pressed={ownerFilter === filter.value}
              className={cns(
                'inline-flex h-7 items-center rounded-full px-2.5 text-xs font-medium',
                'transition-colors duration-150 ease-smooth',
                'focus-visible:shadow-focus',
                ownerFilter === filter.value
                  ? 'bg-primary-900 text-primary-300'
                  : 'bg-bg-surface text-text-secondary hover:bg-bg-overlay hover:text-text',
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {/* Status filter pills */}
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Filter by status"
        >
          {STATUS_FILTERS.map(filter => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setStatusFilter(filter.value)}
              aria-pressed={statusFilter === filter.value}
              className={cns(
                'inline-flex h-7 items-center rounded-full px-2.5 text-xs font-medium',
                'transition-colors duration-150 ease-smooth',
                'focus-visible:shadow-focus',
                statusFilter === filter.value
                  ? 'bg-primary-900 text-primary-300'
                  : 'bg-bg-surface text-text-secondary hover:bg-bg-overlay hover:text-text',
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {/* Item list or empty state */}
      {filteredItems.length > 0 ? (
        <div className="flex flex-col gap-2">
          {filteredItems.map(item => (
            <DashboardActionItemCard
              key={item.id}
              item={item}
              userId={userId}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-md border border-border-subtle bg-bg-raised py-6">
          <HiClipboardDocumentCheck className="h-6 w-6 text-text-muted" />
          <p className="text-sm text-text-muted">
            {getEmptyMessage(ownerFilter, statusFilter)}
          </p>
        </div>
      )}
    </div>
  )
}
