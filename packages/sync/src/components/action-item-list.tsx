'use client'

import type { ActionItem, CheckInStatus } from 'src/app/(app)/check-ins/types'

import { ActionItemCard } from './action-item-card'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ActionItemListProps {
  actionItems: ActionItem[]
  userId: string
  checkInStatus: CheckInStatus
  /** When true, shows a "No action items" message for empty lists */
  showEmpty?: boolean
}

// ---------------------------------------------------------------------------
// ActionItemList
// ---------------------------------------------------------------------------

export function ActionItemList({
  actionItems,
  userId,
  checkInStatus,
  showEmpty = false,
}: ActionItemListProps) {
  if (actionItems.length === 0) {
    if (!showEmpty) return null

    return <p className="text-xs text-text-muted italic">No action items yet</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {actionItems.map(item => (
        <ActionItemCard
          key={item.id}
          item={item}
          userId={userId}
          checkInStatus={checkInStatus}
        />
      ))}
    </div>
  )
}
