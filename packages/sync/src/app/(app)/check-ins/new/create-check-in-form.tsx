'use client'

import { cns } from '@lilnas/utils/cns'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useCallback, useState } from 'react'
import {
  HiArrowLeft,
  HiCheck,
  HiClock,
  HiRectangleStack,
} from 'react-icons/hi2'

import { createCheckIn } from 'src/app/(app)/check-ins/actions'
import type { TemplateListItem } from 'src/app/(app)/templates/types'
import { Badge } from 'src/components/ui/badge'
import { Button } from 'src/components/ui/button'
import { FormField } from 'src/components/ui/form-field'
import { Input } from 'src/components/ui/input'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CreateCheckInFormProps {
  templates: TemplateListItem[]
}

// ---------------------------------------------------------------------------
// CreateCheckInForm
// ---------------------------------------------------------------------------

export function CreateCheckInForm({ templates }: CreateCheckInFormProps) {
  const router = useRouter()

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  )
  const [title, setTitle] = useState('')
  const [scheduledFor, setScheduledFor] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId)

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setError(null)

      if (!selectedTemplateId) {
        setError('Please select a template.')
        return
      }

      setLoading(true)

      const scheduledDate = scheduledFor ? new Date(scheduledFor) : undefined

      const result = await createCheckIn({
        templateId: selectedTemplateId,
        title: title.trim() || undefined,
        scheduledFor: scheduledDate,
      })

      if (result.success && result.checkInId) {
        router.push(`/check-ins/${result.checkInId}`)
      } else if (!result.success) {
        setError(result.error)
        setLoading(false)
      }
    },
    [selectedTemplateId, title, scheduledFor, router],
  )

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-6 animate-fade-in"
    >
      {/* Back link */}
      <Link
        href="/check-ins"
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
        New Check-in
      </h1>

      {/* Template selector */}
      <div className="flex flex-col gap-3">
        <span className="text-sm font-medium text-text-secondary">
          Choose a template <span className="text-error">*</span>
        </span>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {templates.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelectedTemplateId(t.id)}
              className={cns(
                'flex flex-col gap-2 rounded-md border p-4 text-left',
                'transition-all duration-150 ease-smooth',
                'focus-visible:shadow-focus',
                selectedTemplateId === t.id
                  ? 'border-primary bg-primary-900/30 shadow-glow'
                  : 'border-border bg-bg-surface hover:border-primary-700',
              )}
            >
              <div className="flex items-center gap-2">
                <HiRectangleStack className="h-4 w-4 shrink-0 text-primary-400" />
                <span className="text-sm font-semibold text-text">
                  {t.name}
                </span>
                {t.isSystem && <Badge>System</Badge>}
              </div>

              {t.description && (
                <p className="line-clamp-2 text-xs text-text-secondary">
                  {t.description}
                </p>
              )}

              <Badge variant="neutral">
                {t.questionCount}{' '}
                {t.questionCount === 1 ? 'question' : 'questions'}
              </Badge>
            </button>
          ))}
        </div>
      </div>

      {/* Divider */}
      <hr className="border-border-subtle" />

      {/* Title (optional) */}
      <FormField
        label="Title (optional)"
        hint={
          selectedTemplate
            ? `Defaults to "${selectedTemplate.name} - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}"`
            : undefined
        }
      >
        <Input
          placeholder="e.g. Sunday Check-in"
          value={title}
          onChange={e => setTitle(e.target.value)}
          maxLength={200}
        />
      </FormField>

      {/* Schedule (optional) */}
      <FormField
        label="Schedule for later (optional)"
        hint="Leave empty to start as a draft you can begin anytime."
      >
        <div className="relative">
          <HiClock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <Input
            type="datetime-local"
            value={scheduledFor}
            onChange={e => setScheduledFor(e.target.value)}
            className="pl-9"
          />
        </div>
      </FormField>

      {/* Error */}
      {error && <p className="text-sm text-error animate-fade-in">{error}</p>}

      {/* Submit */}
      <Button
        type="submit"
        size="lg"
        className="w-full"
        loading={loading}
        disabled={!selectedTemplateId}
      >
        <HiCheck className="h-4 w-4" />
        {loading ? 'Creating...' : 'Create Check-in'}
      </Button>
    </form>
  )
}
