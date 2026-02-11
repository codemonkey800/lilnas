// ---------------------------------------------------------------------------
// Check-in types
// ---------------------------------------------------------------------------

export type CheckInStatus = 'draft' | 'scheduled' | 'in_progress' | 'completed'

// ---------------------------------------------------------------------------
// Action item types
// ---------------------------------------------------------------------------

export type ActionItemOwnerType = 'individual' | 'both'
export type ActionItemStatus = 'open' | 'in_progress' | 'completed'

export interface ActionItem {
  id: string
  checkInId: string
  checkInQuestionId: string
  description: string
  ownerType: ActionItemOwnerType
  ownerId: string | null
  ownerDisplayName: string | null
  createdById: string
  status: ActionItemStatus
  dueDate: Date | null
  completedAt: Date | null
  createdAt: Date | null
}

export interface CreateActionItemInput {
  checkInId: string
  checkInQuestionId: string
  description: string
  ownerType: ActionItemOwnerType
  ownerId?: string
}

export type ActionResult =
  | { success: true; checkInId?: string }
  | { success: false; error: string }

export interface CreateCheckInInput {
  templateId: string
  title?: string
  scheduledFor?: Date
}

export interface CheckInListItem {
  id: string
  title: string
  status: CheckInStatus
  scheduledFor: Date | null
  completedAt: Date | null
  createdAt: Date | null
  questionCount: number
}

export interface CheckInQuestion {
  id: string
  questionText: string
  orderIndex: number
}

export interface CheckInResponse {
  id: string
  checkInQuestionId: string
  userId: string
  displayName: string
  responseText: string | null
}

export interface CheckInDetail {
  id: string
  title: string
  status: CheckInStatus
  templateId: string
  partnershipId: string
  scheduledFor: Date | null
  startedAt: Date | null
  completedAt: Date | null
  createdById: string
  createdAt: Date | null
  questions: CheckInQuestion[]
  responses: CheckInResponse[]
}
