'use client'

import { cns } from '@lilnas/utils/cns'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import {
  HiDocumentDuplicate,
  HiEye,
  HiPencil,
  HiRectangleStack,
  HiTrash,
} from 'react-icons/hi2'

import { Badge } from 'src/components/ui/badge'
import { Button } from 'src/components/ui/button'
import { Dialog } from 'src/components/ui/dialog'

import { deleteTemplate, duplicateTemplate } from './actions'
import type { TemplateListItem } from './types'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TemplateCardProps {
  template: TemplateListItem
}

// ---------------------------------------------------------------------------
// TemplateCard
// ---------------------------------------------------------------------------

export function TemplateCard({ template }: TemplateCardProps) {
  const router = useRouter()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDuplicate = useCallback(async () => {
    setError(null)
    setDuplicating(true)

    const result = await duplicateTemplate(template.id)

    if (result.success) {
      router.refresh()
    } else {
      setError(result.error)
    }

    setDuplicating(false)
  }, [template.id, router])

  return (
    <>
      <div
        className={cns(
          'flex flex-col gap-3 rounded-md border border-border',
          'bg-bg-surface p-4 shadow-md',
          'transition-all duration-150 ease-smooth',
          'hover:border-primary-700 hover:shadow-glow',
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <HiRectangleStack className="h-4 w-4 shrink-0 text-primary-400" />
            <h3 className="text-base font-semibold text-text">
              {template.name}
            </h3>
          </div>

          {template.isSystem && <Badge>System</Badge>}
        </div>

        {/* Description */}
        {template.description && (
          <p className="line-clamp-2 text-sm text-text-secondary">
            {template.description}
          </p>
        )}

        {/* Meta */}
        <div className="flex items-center gap-2">
          <Badge variant="neutral">
            {template.questionCount}{' '}
            {template.questionCount === 1 ? 'question' : 'questions'}
          </Badge>
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-error animate-fade-in">{error}</p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 border-t border-border-subtle pt-3">
          <Link
            href={`/templates/${template.id}`}
            className={cns(
              'flex h-8 w-8 items-center justify-center rounded-sm',
              'text-text-secondary',
              'transition-colors duration-150 ease-smooth',
              'hover:bg-bg-overlay hover:text-text',
              'focus-visible:shadow-focus',
            )}
            aria-label={`View ${template.name}`}
          >
            <HiEye className="h-4 w-4" />
          </Link>

          {!template.isSystem && (
            <Link
              href={`/templates/${template.id}/edit`}
              className={cns(
                'flex h-8 w-8 items-center justify-center rounded-sm',
                'text-text-secondary',
                'transition-colors duration-150 ease-smooth',
                'hover:bg-bg-overlay hover:text-text',
                'focus-visible:shadow-focus',
              )}
              aria-label={`Edit ${template.name}`}
            >
              <HiPencil className="h-4 w-4" />
            </Link>
          )}

          <button
            type="button"
            onClick={handleDuplicate}
            disabled={duplicating}
            className={cns(
              'flex h-8 w-8 items-center justify-center rounded-sm',
              'text-text-secondary',
              'transition-colors duration-150 ease-smooth',
              'hover:bg-bg-overlay hover:text-text',
              'focus-visible:shadow-focus',
              'disabled:opacity-40',
            )}
            aria-label={`Duplicate ${template.name}`}
          >
            <HiDocumentDuplicate className="h-4 w-4" />
          </button>

          {!template.isSystem && (
            <button
              type="button"
              onClick={() => setShowDeleteDialog(true)}
              className={cns(
                'flex h-8 w-8 items-center justify-center rounded-sm',
                'text-error',
                'transition-colors duration-150 ease-smooth',
                'hover:bg-error-muted',
                'focus-visible:shadow-focus',
              )}
              aria-label={`Delete ${template.name}`}
            >
              <HiTrash className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {showDeleteDialog && (
        <DeleteConfirmDialog
          templateId={template.id}
          templateName={template.name}
          onClose={() => setShowDeleteDialog(false)}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// DeleteConfirmDialog
// ---------------------------------------------------------------------------

interface DeleteConfirmDialogProps {
  templateId: string
  templateName: string
  onClose: () => void
}

function DeleteConfirmDialog({
  templateId,
  templateName,
  onClose,
}: DeleteConfirmDialogProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = useCallback(async () => {
    setError(null)
    setLoading(true)

    const result = await deleteTemplate(templateId)

    if (result.success) {
      onClose()
      router.refresh()
    } else {
      setError(result.error)
      setLoading(false)
    }
  }, [templateId, onClose, router])

  return (
    <Dialog
      open
      onClose={onClose}
      loading={loading}
      aria-labelledby="delete-template-dialog-title"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-error-muted">
            <HiTrash className="h-6 w-6 text-error" />
          </div>

          <h2
            id="delete-template-dialog-title"
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
