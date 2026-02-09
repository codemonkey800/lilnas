'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import {
  HiEnvelope,
  HiExclamationTriangle,
  HiHeart,
  HiLink,
} from 'react-icons/hi2'

import { Avatar } from 'src/components/ui/avatar'
import { Badge } from 'src/components/ui/badge'
import { Button } from 'src/components/ui/button'
import { Card, CardInner } from 'src/components/ui/card'
import { Dialog } from 'src/components/ui/dialog'

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
      <Card>
        {/* Connected badge */}
        <div className="flex items-center justify-center gap-2">
          <HiHeart className="h-5 w-5 text-primary-400" />
          <Badge>Connected</Badge>
        </div>

        {/* Partner info */}
        <CardInner>
          <Avatar initial={displayName} />

          <div className="flex flex-col items-center gap-1">
            <span className="text-lg font-semibold text-text">
              {displayName}
            </span>

            {pronouns && <Badge variant="neutral">{pronouns}</Badge>}

            {email && (
              <span className="flex items-center gap-1.5 text-sm text-text-muted">
                <HiEnvelope className="h-3.5 w-3.5" />
                {email}
              </span>
            )}
          </div>
        </CardInner>

        {/* Divider */}
        <hr className="border-border-subtle" />

        {/* Unlink button */}
        <Button
          variant="destructive"
          className="w-full"
          onClick={() => setShowDialog(true)}
        >
          <HiLink className="h-4 w-4" />
          Unlink
        </Button>
      </Card>

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
// UnlinkConfirmDialog
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
    <Dialog
      open
      onClose={onClose}
      loading={loading}
      aria-labelledby="unlink-dialog-title"
    >
      <div className="flex flex-col gap-4">
        {/* Icon + Title */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-warning-muted">
            <HiExclamationTriangle className="h-6 w-6 text-warning" />
          </div>

          <h2
            id="unlink-dialog-title"
            className="text-lg font-semibold text-text"
          >
            Unlink from {displayName}?
          </h2>

          <p className="text-sm text-text-secondary">
            Your check-in history will be preserved, but you won&apos;t be able
            to create new check-ins together.
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
            onClick={handleUnlink}
            loading={loading}
          >
            {loading ? 'Unlinking...' : 'Unlink'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
