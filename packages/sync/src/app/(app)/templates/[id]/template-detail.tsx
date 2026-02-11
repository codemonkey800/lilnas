'use client'

import { cns } from '@lilnas/utils/cns'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import {
  HiArrowLeft,
  HiDocumentDuplicate,
  HiPencil,
  HiRectangleStack,
  HiTrash,
} from 'react-icons/hi2'

import { Badge } from 'src/components/ui/badge'
import { Button } from 'src/components/ui/button'
import { Dialog } from 'src/components/ui/dialog'

import { deleteTemplate, duplicateTemplate } from '../actions'
import type { TemplateDetail as TemplateDetailType } from '../types'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TemplateDetailProps {
  template: TemplateDetailType
}

// ---------------------------------------------------------------------------
// TemplateDetail
// ---------------------------------------------------------------------------

export function TemplateDetail({ template }: TemplateDetailProps) {
  const router = useRouter()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDuplicate = useCallback(async () => {
    setError(null)
    setDuplicating(true)

    const result = await duplicateTemplate(template.id)

    if (result.success && result.templateId) {
      router.push(`/templates/${result.templateId}`)
    } else if (!result.success) {
      setError(result.error)
      setDuplicating(false)
    }
  }, [template.id, router])

  const handleDeleted = useCallback(() => {
    router.push('/templates')
  }, [router])

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      {/* Back link */}
      <Link
        href="/templates"
        className={cns(
          'inline-flex items-center gap-1.5 self-start text-sm font-medium',
          'text-text-secondary',
          'transition-colors duration-150 ease-smooth',
          'hover:text-text',
          'focus-visible:shadow-focus rounded-sm',
        )}
      >
        <HiArrowLeft className="h-4 w-4" />
        All templates
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <HiRectangleStack className="h-6 w-6 shrink-0 text-primary-400" />
          <h1 className="text-2xl font-bold tracking-tight text-text md:text-3xl">
            {template.name}
          </h1>
          {template.isSystem && <Badge>System</Badge>}
        </div>

        {template.description && (
          <p className="text-text-secondary">{template.description}</p>
        )}
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2">
        {!template.isSystem && (
          <Link href={`/templates/${template.id}/edit`}>
            <Button variant="secondary" size="sm">
              <HiPencil className="h-4 w-4" />
              Edit
            </Button>
          </Link>
        )}

        <Button
          variant="secondary"
          size="sm"
          onClick={handleDuplicate}
          loading={duplicating}
        >
          <HiDocumentDuplicate className="h-4 w-4" />
          Duplicate
        </Button>

        {!template.isSystem && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteDialog(true)}
          >
            <HiTrash className="h-4 w-4" />
            Delete
          </Button>
        )}
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-error animate-fade-in">{error}</p>
      )}

      {/* Divider */}
      <hr className="border-border-subtle" />

      {/* Questions */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text">Questions</h2>
          <Badge variant="neutral">
            {template.questions.length}{' '}
            {template.questions.length === 1 ? 'question' : 'questions'}
          </Badge>
        </div>

        <div className="flex flex-col gap-2">
          {template.questions.map((q, index) => (
            <div
              key={q.id}
              className={cns(
                'flex items-start gap-3 rounded-md border border-border-subtle',
                'bg-bg-raised p-4',
              )}
            >
              <span className="mt-0.5 text-sm font-bold text-primary-400 tabular-nums">
                {index + 1}
              </span>

              <div className="flex flex-1 flex-col gap-1">
                <p className="text-sm text-text">{q.questionText}</p>
                {!q.isRequired && (
                  <span className="text-xs text-text-muted">Optional</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Delete confirm dialog */}
      {showDeleteDialog && (
        <DeleteDetailDialog
          templateId={template.id}
          templateName={template.name}
          onClose={() => setShowDeleteDialog(false)}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// DeleteDetailDialog
// ---------------------------------------------------------------------------

interface DeleteDetailDialogProps {
  templateId: string
  templateName: string
  onClose: () => void
  onDeleted: () => void
}

function DeleteDetailDialog({
  templateId,
  templateName,
  onClose,
  onDeleted,
}: DeleteDetailDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = useCallback(async () => {
    setError(null)
    setLoading(true)

    const result = await deleteTemplate(templateId)

    if (result.success) {
      onDeleted()
    } else {
      setError(result.error)
      setLoading(false)
    }
  }, [templateId, onDeleted])

  return (
    <Dialog
      open
      onClose={onClose}
      loading={loading}
      aria-labelledby="delete-detail-dialog-title"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-error-muted">
            <HiTrash className="h-6 w-6 text-error" />
          </div>

          <h2
            id="delete-detail-dialog-title"
            className="text-lg font-semibold text-text"
          >
            Delete &ldquo;{templateName}&rdquo;?
          </h2>

          <p className="text-sm text-text-secondary">
            This will permanently delete this template and all its questions.
            This action cannot be undone.
          </p>
        </div>

        {error && (
          <p className="text-center text-sm text-error animate-fade-in">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <Button
            autoFocus
            variant="ghost"
            className="flex-1"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>

          <Button
            variant="destructive"
            className="flex-1 bg-error-muted"
            onClick={handleDelete}
            loading={loading}
          >
            {loading ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
