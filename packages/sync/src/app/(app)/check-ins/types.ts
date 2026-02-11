// ---------------------------------------------------------------------------
// Check-in types
// ---------------------------------------------------------------------------

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
  status: 'draft' | 'scheduled' | 'in_progress' | 'completed'
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
  status: 'draft' | 'scheduled' | 'in_progress' | 'completed'
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
