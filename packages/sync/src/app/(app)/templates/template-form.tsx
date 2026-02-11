'use client'

import { cns } from '@lilnas/utils/cns'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useCallback, useState } from 'react'
import { HiArrowLeft, HiCheck } from 'react-icons/hi2'

import { Button } from 'src/components/ui/button'
import { FormField } from 'src/components/ui/form-field'
import { Input } from 'src/components/ui/input'

import { createTemplate, updateTemplate } from './actions'
import { QuestionBuilder } from './question-builder'
import type { QuestionInput, TemplateDetail } from './types'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TemplateFormProps {
  mode: 'create' | 'edit'
  initialData?: TemplateDetail
}

// ---------------------------------------------------------------------------
// TemplateForm
// ---------------------------------------------------------------------------

export function TemplateForm({ mode, initialData }: TemplateFormProps) {
  const router = useRouter()

  const [name, setName] = useState(initialData?.name ?? '')
  const [description, setDescription] = useState(
    initialData?.description ?? '',
  )
  const [questions, setQuestions] = useState<QuestionInput[]>(
    initialData?.questions.map(q => ({
      questionText: q.questionText,
      isRequired: q.isRequired,
    })) ?? [{ questionText: '', isRequired: true }],
  )

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setError(null)

      // Client-side validation
      const trimmedName = name.trim()
      if (!trimmedName || trimmedName.length > 100) {
        setError('Template name must be between 1 and 100 characters.')
        return
      }

      const nonEmptyQuestions = questions.filter(
        q => q.questionText.trim().length > 0,
      )
      if (nonEmptyQuestions.length === 0) {
        setError('Add at least one question.')
        return
      }

      for (const q of nonEmptyQuestions) {
        if (q.questionText.trim().length > 500) {
          setError('Each question must be 500 characters or less.')
          return
        }
      }

      setLoading(true)

      const result =
        mode === 'create'
          ? await createTemplate({
              name: trimmedName,
              description: description.trim() || undefined,
              questions: nonEmptyQuestions,
            })
          : await updateTemplate(initialData!.id, {
              name: trimmedName,
              description: description.trim() || null,
              questions: nonEmptyQuestions,
            })

      if (result.success) {
        const targetId = result.templateId ?? initialData?.id
        router.push(targetId ? `/templates/${targetId}` : '/templates')
      } else {
        setError(result.error)
        setLoading(false)
      }
    },
    [name, description, questions, mode, initialData, router],
  )

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6 animate-fade-in">
      {/* Back link */}
      <Link
        href={
          mode === 'edit' && initialData
            ? `/templates/${initialData.id}`
            : '/templates'
        }
        className={cns(
          'inline-flex items-center gap-1.5 self-start text-sm font-medium',
          'text-text-secondary',
          'transition-colors duration-150 ease-smooth',
          'hover:text-text',
          'focus-visible:shadow-focus rounded-sm',
        )}
      >
        <HiArrowLeft className="h-4 w-4" />
        Back
      </Link>

      {/* Heading */}
      <h1 className="text-2xl font-bold tracking-tight text-text md:text-3xl">
        {mode === 'create' ? 'New Template' : 'Edit Template'}
      </h1>

      {/* Name */}
      <FormField label="Template name">
        <Input
          required
          autoFocus
          placeholder="e.g. Weekly Check-in"
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={100}
        />
      </FormField>

      {/* Description */}
      <FormField label="Description (optional)">
        <textarea
          placeholder="A brief description of when to use this template..."
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
          className={cns(
            'w-full rounded-sm border border-border bg-bg-raised px-3 py-2',
            'text-sm text-text placeholder:text-text-muted',
            'transition-colors duration-150 ease-smooth',
            'focus:border-primary focus:outline-none focus-visible:shadow-focus',
            'resize-none',
          )}
        />
      </FormField>

      {/* Divider */}
      <hr className="border-border-subtle" />

      {/* Questions */}
      <QuestionBuilder questions={questions} onChange={setQuestions} />

      {/* Error */}
      {error && (
        <p className="text-sm text-error animate-fade-in">{error}</p>
      )}

      {/* Submit */}
      <Button
        type="submit"
        size="lg"
        className="w-full"
        loading={loading}
        disabled={!name.trim()}
      >
        <HiCheck className="h-4 w-4" />
        {loading
          ? mode === 'create'
            ? 'Creating...'
            : 'Saving...'
          : mode === 'create'
            ? 'Create Template'
            : 'Save Changes'}
      </Button>
    </form>
  )
}
