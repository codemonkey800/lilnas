import { describe, expect, it } from 'vitest'

import {
  formatCheckInDate,
  guardCanRespond,
  guardCompleted,
  guardDraft,
  guardInProgress,
  guardNoPendingTransition,
  validateResponseText,
  validateTitle,
} from 'src/app/(app)/check-ins/helpers'

// ---------------------------------------------------------------------------
// State guards
// ---------------------------------------------------------------------------

describe('guardDraft', () => {
  it('returns null for "draft"', () => {
    expect(guardDraft('draft')).toBeNull()
  })

  it.each(['in_progress', 'completed'] as const)(
    'returns an error for "%s"',
    status => {
      expect(guardDraft(status)).toBe(
        'This check-in can no longer be modified.',
      )
    },
  )
})

describe('guardCanRespond', () => {
  it.each(['draft', 'in_progress'] as const)(
    'returns null for "%s"',
    status => {
      expect(guardCanRespond(status)).toBeNull()
    },
  )

  it('returns an error for "completed"', () => {
    expect(guardCanRespond('completed')).toBe(
      'This check-in is completed. Re-open it to edit responses.',
    )
  })
})

describe('guardInProgress', () => {
  it('returns null for "in_progress"', () => {
    expect(guardInProgress('in_progress')).toBeNull()
  })

  it.each(['draft', 'completed'] as const)(
    'returns an error for "%s"',
    status => {
      expect(guardInProgress(status)).toBe(
        'This check-in is not currently in progress.',
      )
    },
  )
})

describe('guardCompleted', () => {
  it('returns null for "completed"', () => {
    expect(guardCompleted('completed')).toBeNull()
  })

  it.each(['draft', 'in_progress'] as const)(
    'returns an error for "%s"',
    status => {
      expect(guardCompleted(status)).toBe('This check-in is not completed.')
    },
  )
})

describe('guardNoPendingTransition', () => {
  it('returns null when no pending transition', () => {
    expect(guardNoPendingTransition(null)).toBeNull()
  })

  it.each(['start', 'complete', 'reopen'])(
    'returns an error when pending transition is "%s"',
    transition => {
      expect(guardNoPendingTransition(transition)).toBe(
        'A transition request is already pending for this check-in.',
      )
    },
  )
})

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

describe('validateTitle', () => {
  it('returns null for a valid title', () => {
    expect(validateTitle('Weekly Check-in')).toBeNull()
  })

  it('returns null for a title at the 200-character limit', () => {
    expect(validateTitle('x'.repeat(200))).toBeNull()
  })

  it('returns an error for an empty string', () => {
    expect(validateTitle('')).toBe(
      'Title must be between 1 and 200 characters.',
    )
  })

  it('returns an error for a whitespace-only string', () => {
    expect(validateTitle('   ')).toBe(
      'Title must be between 1 and 200 characters.',
    )
  })

  it('returns an error for a title exceeding 200 characters', () => {
    expect(validateTitle('x'.repeat(201))).toBe(
      'Title must be between 1 and 200 characters.',
    )
  })

  it('trims whitespace before checking length', () => {
    // 200 chars + surrounding spaces should still be valid
    expect(validateTitle(`  ${'x'.repeat(200)}  `)).toBeNull()
  })
})

describe('validateResponseText', () => {
  it('returns null for an empty response', () => {
    expect(validateResponseText('')).toBeNull()
  })

  it('returns null for a response at the 5,000-character limit', () => {
    expect(validateResponseText('x'.repeat(5_000))).toBeNull()
  })

  it('returns an error for a response exceeding 5,000 characters', () => {
    expect(validateResponseText('x'.repeat(5_001))).toBe(
      'Response must be 5,000 characters or fewer.',
    )
  })
})

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

describe('formatCheckInDate', () => {
  it('returns "Completed: ..." for a completed check-in with completedAt', () => {
    const result = formatCheckInDate({
      status: 'completed',
      completedAt: new Date('2025-06-20T00:00:00'),
      createdAt: new Date('2025-06-10T00:00:00'),
    })
    expect(result).toBe('Completed: Jun 20, 2025')
  })

  it('falls back to createdAt for draft check-ins', () => {
    const result = formatCheckInDate({
      status: 'draft',
      completedAt: null,
      createdAt: new Date('2025-01-05T00:00:00'),
    })
    expect(result).toBe('Jan 5, 2025')
  })

  it('falls back to createdAt for in_progress check-ins', () => {
    const result = formatCheckInDate({
      status: 'in_progress',
      completedAt: null,
      createdAt: new Date('2025-09-30T00:00:00'),
    })
    expect(result).toBe('Sep 30, 2025')
  })

  it('returns null when all date fields are null', () => {
    const result = formatCheckInDate({
      status: 'draft',
      completedAt: null,
      createdAt: null,
    })
    expect(result).toBeNull()
  })
})
