'use client'

import { cns } from '@lilnas/utils/cns'
import { useCallback } from 'react'
import {
  HiArrowDown,
  HiArrowUp,
  HiPlus,
  HiTrash,
} from 'react-icons/hi2'

import { Button } from 'src/components/ui/button'
import { Input } from 'src/components/ui/input'

import { MAX_QUESTIONS } from './constants'
import type { QuestionInput } from './types'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface QuestionBuilderProps {
  questions: QuestionInput[]
  onChange: (questions: QuestionInput[]) => void
}

// ---------------------------------------------------------------------------
// QuestionBuilder
// ---------------------------------------------------------------------------

export function QuestionBuilder({ questions, onChange }: QuestionBuilderProps) {
  const canAdd = questions.length < MAX_QUESTIONS

  const handleAdd = useCallback(() => {
    if (!canAdd) return
    onChange([...questions, { questionText: '', isRequired: true }])
  }, [questions, onChange, canAdd])

  const handleRemove = useCallback(
    (index: number) => {
      onChange(questions.filter((_, i) => i !== index))
    },
    [questions, onChange],
  )

  const handleChange = useCallback(
    (index: number, field: keyof QuestionInput, value: string | boolean) => {
      const updated = questions.map((q, i) =>
        i === index ? { ...q, [field]: value } : q,
      )
      onChange(updated)
    },
    [questions, onChange],
  )

  const handleMoveUp = useCallback(
    (index: number) => {
      if (index === 0) return
      const updated = [...questions]
      ;[updated[index - 1], updated[index]] = [
        updated[index]!,
        updated[index - 1]!,
      ]
      onChange(updated)
    },
    [questions, onChange],
  )

  const handleMoveDown = useCallback(
    (index: number) => {
      if (index >= questions.length - 1) return
      const updated = [...questions]
      ;[updated[index], updated[index + 1]] = [
        updated[index + 1]!,
        updated[index]!,
      ]
      onChange(updated)
    },
    [questions, onChange],
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text-secondary">
          Questions
        </span>
        <span className="text-xs text-text-muted">
          {questions.length}/{MAX_QUESTIONS}
        </span>
      </div>

      {questions.length === 0 && (
        <p className="py-4 text-center text-sm text-text-muted">
          No questions yet. Add one to get started.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {questions.map((q, index) => (
          <QuestionRow
            key={index}
            index={index}
            question={q}
            isFirst={index === 0}
            isLast={index === questions.length - 1}
            onChange={handleChange}
            onMoveUp={handleMoveUp}
            onMoveDown={handleMoveDown}
            onRemove={handleRemove}
          />
        ))}
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="self-start"
        onClick={handleAdd}
        disabled={!canAdd}
      >
        <HiPlus className="h-4 w-4" />
        Add question
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// QuestionRow
// ---------------------------------------------------------------------------

interface QuestionRowProps {
  index: number
  question: QuestionInput
  isFirst: boolean
  isLast: boolean
  onChange: (index: number, field: keyof QuestionInput, value: string | boolean) => void
  onMoveUp: (index: number) => void
  onMoveDown: (index: number) => void
  onRemove: (index: number) => void
}

function QuestionRow({
  index,
  question,
  isFirst,
  isLast,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: QuestionRowProps) {
  const charCount = question.questionText.trim().length
  const isOverLimit = charCount > 500

  return (
    <div
      className={cns(
        'flex flex-col gap-2 rounded-md border border-border-subtle',
        'bg-bg-raised p-3',
      )}
    >
      {/* Top row: number + input */}
      <div className="flex items-start gap-2">
        <span className="mt-2 text-xs font-medium text-text-muted tabular-nums">
          {index + 1}.
        </span>

        <div className="flex flex-1 flex-col gap-1">
          <Input
            placeholder="Enter your question..."
            value={question.questionText}
            onChange={e => onChange(index, 'questionText', e.target.value)}
            aria-label={`Question ${index + 1}`}
          />
          <div className="flex items-center justify-between">
            <span
              className={cns(
                'text-xs',
                isOverLimit ? 'text-error' : 'text-text-muted',
              )}
            >
              {charCount}/500
            </span>
          </div>
        </div>
      </div>

      {/* Bottom row: controls */}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={question.isRequired ?? true}
            onChange={e => onChange(index, 'isRequired', e.target.checked)}
            className="accent-primary"
          />
          Required
        </label>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMoveUp(index)}
            disabled={isFirst}
            aria-label={`Move question ${index + 1} up`}
            className={cns(
              'flex h-8 w-8 items-center justify-center rounded-sm',
              'text-text-secondary',
              'transition-colors duration-150 ease-smooth',
              'hover:bg-bg-overlay hover:text-text',
              'focus-visible:shadow-focus',
              'disabled:opacity-40',
            )}
          >
            <HiArrowUp className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => onMoveDown(index)}
            disabled={isLast}
            aria-label={`Move question ${index + 1} down`}
            className={cns(
              'flex h-8 w-8 items-center justify-center rounded-sm',
              'text-text-secondary',
              'transition-colors duration-150 ease-smooth',
              'hover:bg-bg-overlay hover:text-text',
              'focus-visible:shadow-focus',
              'disabled:opacity-40',
            )}
          >
            <HiArrowDown className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => onRemove(index)}
            aria-label={`Remove question ${index + 1}`}
            className={cns(
              'flex h-8 w-8 items-center justify-center rounded-sm',
              'text-error',
              'transition-colors duration-150 ease-smooth',
              'hover:bg-error-muted',
              'focus-visible:shadow-focus',
            )}
          >
            <HiTrash className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
