'use client'

import { cns } from '@lilnas/utils/cns'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  HiEnvelope,
  HiExclamationTriangle,
  HiHeart,
  HiLink,
} from 'react-icons/hi2'

import { dissolvePartnership } from './actions'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PartnerCardProps {
  partnershipId: string
  displayName: string
  pronouns: string | null
  email: string | null
}

// ---------------------------------------------------------------------------
// PartnerCard
// ---------------------------------------------------------------------------

export function PartnerCard({
  partnershipId,
  displayName,
  pronouns,
  email,
}: PartnerCardProps) {
  const [showDialog, setShowDialog] = useState(false)

  return (
    <>
      <div
        className={cns(
          'flex w-full max-w-lg flex-col gap-6',
          'rounded-md border border-border bg-bg-surface p-6 shadow-md md:p-8',
          'animate-fade-in',
        )}
      >
        {/* Connected badge */}
        <div className="flex items-center justify-center gap-2">
          <HiHeart className="h-5 w-5 text-primary-400" />
          <span
            className={cns(
              'inline-flex items-center rounded-full',
              'bg-primary-900 px-2.5 py-0.5 text-xs font-medium text-primary-300',
            )}
          >
            Connected
          </span>
        </div>

        {/* Partner info */}
        <div
          className={cns(
            'flex flex-col items-center gap-3 rounded-md border border-border-subtle',
            'bg-bg-raised p-5',
          )}
        >
          {/* Avatar */}
          <div
            className={cns(
              'flex h-14 w-14 items-center justify-center rounded-full',
              'bg-primary-900 text-xl font-bold text-primary-300',
            )}
          >
            {displayName.charAt(0).toUpperCase()}
          </div>

          <div className="flex flex-col items-center gap-1">
            <span className="text-lg font-semibold text-text">
              {displayName}
            </span>

            {pronouns && (
              <span
                className={cns(
                  'inline-flex items-center rounded-full',
                  'bg-bg-surface px-2.5 py-0.5 text-xs font-medium text-text-secondary',
                )}
              >
                {pronouns}
              </span>
            )}

            {email && (
              <span className="flex items-center gap-1.5 text-sm text-text-muted">
                <HiEnvelope className="h-3.5 w-3.5" />
                {email}
              </span>
            )}
          </div>
        </div>

        {/* Divider */}
        <hr className="border-border-subtle" />

        {/* Unlink button */}
        <button
          type="button"
          onClick={() => setShowDialog(true)}
          className={cns(
            'inline-flex w-full items-center justify-center gap-2',
            'rounded-sm px-4 py-2 text-sm font-medium text-error',
            'transition-colors duration-150 ease-smooth',
            'hover:bg-error-muted hover:text-error',
            'focus-visible:shadow-focus',
          )}
        >
          <HiLink className="h-4 w-4" />
          Unlink
        </button>
      </div>

      {showDialog && (
        <UnlinkConfirmDialog
          partnershipId={partnershipId}
          displayName={displayName}
          onClose={() => setShowDialog(false)}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// UnlinkConfirmDialog (native <dialog> with showModal)
// ---------------------------------------------------------------------------

interface UnlinkConfirmDialogProps {
  partnershipId: string
  displayName: string
  onClose: () => void
}

function UnlinkConfirmDialog({
  partnershipId,
  displayName,
  onClose,
}: UnlinkConfirmDialogProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  // Open as modal on mount; native showModal() provides focus trap + scroll lock
  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  // Wire up native close / cancel events
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    function handleClose() {
      onClose()
    }

    function handleCancel(e: Event) {
      if (loading) e.preventDefault()
    }

    dialog.addEventListener('close', handleClose)
    dialog.addEventListener('cancel', handleCancel)
    return () => {
      dialog.removeEventListener('close', handleClose)
      dialog.removeEventListener('cancel', handleCancel)
    }
  }, [onClose, loading])

  // Close on backdrop click (click outside the dialog box)
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (loading) return
      const rect = e.currentTarget.getBoundingClientRect()
      const clickedOutside =
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      if (clickedOutside) {
        e.currentTarget.close()
      }
    },
    [loading],
  )

  const handleUnlink = useCallback(async () => {
    setError(null)
    setLoading(true)

    const result = await dissolvePartnership(partnershipId)

    if (result.success) {
      router.push('/partner')
    } else {
      setError(result.error)
      setLoading(false)
    }
  }, [partnershipId, router])

  return (
    <dialog
      ref={dialogRef}
      onClick={handleBackdropClick}
      className={cns(
        'w-full max-w-sm border-none',
        'rounded-lg bg-bg-overlay p-6 shadow-lg',
        'animate-scale-in',
      )}
      aria-labelledby="unlink-dialog-title"
    >
      <div className="flex flex-col gap-4">
        {/* Icon + Title */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div
            className={cns(
              'flex h-12 w-12 items-center justify-center rounded-full',
              'bg-warning-muted',
            )}
          >
            <HiExclamationTriangle className="h-6 w-6 text-warning" />
          </div>

          <h2
            id="unlink-dialog-title"
            className="text-lg font-semibold text-text"
          >
            Unlink from {displayName}?
          </h2>

          <p className="text-sm text-text-secondary">
            Your check-in history will be preserved, but you won&apos;t be
            able to create new check-ins together.
          </p>
        </div>

        {/* Error */}
        {error && (
          <p className="text-center text-sm text-error animate-fade-in">
            {error}
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            type="button"
            autoFocus
            onClick={() => dialogRef.current?.close()}
            disabled={loading}
            className={cns(
              'flex-1 rounded-sm px-4 py-2 text-sm font-medium text-text-secondary',
              'transition-colors duration-150 ease-smooth',
              'hover:bg-bg-surface hover:text-text',
              'focus-visible:shadow-focus',
              'disabled:opacity-40',
            )}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleUnlink}
            disabled={loading}
            className={cns(
              'flex-1 rounded-sm bg-error-muted px-4 py-2 text-sm font-medium text-error',
              'transition-colors duration-150 ease-smooth',
              'hover:bg-error-muted/80',
              'focus-visible:shadow-focus',
              'disabled:opacity-40',
            )}
          >
            {loading ? 'Unlinking...' : 'Unlink'}
          </button>
        </div>
      </div>
    </dialog>
  )
}
