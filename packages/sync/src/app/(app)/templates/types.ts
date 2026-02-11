// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActionResult =
  | { success: true; templateId?: string }
  | { success: false; error: string }

export interface TemplateListItem {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  questionCount: number
}

export interface TemplateDetail {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  partnershipId: string | null
  createdById: string | null
  questions: Array<{
    id: string
    questionText: string
    isRequired: boolean
    orderIndex: number
  }>
}

export interface QuestionInput {
  questionText: string
  isRequired?: boolean
}

export interface CreateTemplateInput {
  name: string
  description?: string
  questions: QuestionInput[]
}

export interface UpdateTemplateInput {
  name?: string
  description?: string | null
  questions?: QuestionInput[]
}
