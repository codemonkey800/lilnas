import { MAX_QUESTIONS } from './constants'
import type { QuestionInput } from './types'

// Re-export shared partnership helpers for backward compatibility
export {
  getActivePartnership,
  isPartnershipMember,
} from 'src/services/partnership'

// ---------------------------------------------------------------------------
// Template-specific helpers
// ---------------------------------------------------------------------------

/**
 * Validate a template name.
 * Returns an error string if invalid, null if valid.
 */
export function validateName(name: string): string | null {
  const trimmedName = name.trim()
  if (!trimmedName || trimmedName.length > 100) {
    return 'Template name must be between 1 and 100 characters.'
  }
  return null
}

/**
 * Validate a list of template questions.
 * Returns an error string if invalid, null if valid.
 */
export function validateQuestions(questions: QuestionInput[]): string | null {
  if (questions.length === 0) {
    return 'A template must have at least one question.'
  }
  if (questions.length > MAX_QUESTIONS) {
    return `A template can have at most ${MAX_QUESTIONS} questions.`
  }
  for (const q of questions) {
    const trimmedText = q.questionText.trim()
    if (!trimmedText || trimmedText.length > 500) {
      return 'Each question must be between 1 and 500 characters.'
    }
  }
  return null
}

/**
 * Validate the common name + questions constraints.
 * Returns an error string if invalid, null if valid.
 */
export function validateTemplateInput(
  name: string,
  questions: QuestionInput[],
): string | null {
  return validateName(name) ?? validateQuestions(questions)
}
