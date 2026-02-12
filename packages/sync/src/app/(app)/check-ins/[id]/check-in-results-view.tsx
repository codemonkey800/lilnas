'use client'

import { cns } from '@lilnas/utils/cns'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import { HiArrowLeft, HiArrowPath, HiSparkles } from 'react-icons/hi2'

import {
  cancelTransition,
  confirmTransition,
  reopenCheckIn,
} from 'src/app/(app)/check-ins/check-in.actions'
import type { ActionItem, CheckInDetail } from 'src/app/(app)/check-ins/types'
import { ActionItemList } from 'src/components/action-item-list'
import { CheckInStatusBadge } from 'src/components/check-in-status-badge'
import { PendingTransitionBanner } from 'src/components/pending-transition-banner'
import { Button } from 'src/components/ui/button'
import { Dialog } from 'src/components/ui/dialog'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CheckInResultsViewProps {
  checkIn: CheckInDetail
  userId: string
  actionItems: ActionItem[]
}

// ---------------------------------------------------------------------------
// CheckInResultsView
// ---------------------------------------------------------------------------

export function CheckInResultsView({
  checkIn,
  userId,
  actionItems,
}: CheckInResultsViewProps) {
  const router = useRouter()

  // Pending transition state
  const hasPendingReopen = checkIn.pendingTransition === 'reopen'
  const isInitiator = checkIn.pendingTransitionById === userId
  const pendingByName = checkIn.pendingTransitionByName ?? 'Partner'
  const partnerName = checkIn.partnerDisplayName ?? 'Partner'

  // Derive display names for both partners
  const { userDisplayName, partnerDisplayName } = useMemo(() => {
    const userResponse = checkIn.responses.find(r => r.userId === userId)
    const partnerResponse = checkIn.responses.find(r => r.userId !== userId)
    return {
      userDisplayName: userResponse?.displayName ?? 'You',
      partnerDisplayName: partnerResponse?.displayName ?? 'Partner',
    }
  }, [checkIn.responses, userId])

  // Build response maps for both partners: questionId -> responseText
  const userResponses: Record<string, string> = {}
  const partnerResponses: Record<string, string> = {}

  for (const r of checkIn.responses) {
    if (r.userId === userId) {
      userResponses[r.checkInQuestionId] = r.responseText ?? ''
    } else {
      partnerResponses[r.checkInQuestionId] = r.responseText ?? ''
    }
  }

  // Build action items map: questionId -> ActionItem[]
  const actionItemsByQuestion = useMemo(() => {
    const map: Record<string, ActionItem[]> = {}
    for (const item of actionItems) {
      const list = map[item.checkInQuestionId] ?? []
      list.push(item)
      map[item.checkInQuestionId] = list
    }
    return map
  }, [actionItems])

  const [showReopenDialog, setShowReopenDialog] = useState(false)
  const [reopening, setReopening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleReopen = useCallback(async () => {
    setError(null)
    setReopening(true)

    const result = await reopenCheckIn(checkIn.id)

    if (result.success) {
      setShowReopenDialog(false)
      router.refresh()
    } else {
      setError(result.error)
      setReopening(false)
    }
  }, [checkIn.id, router])

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
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
        All check-ins
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-text md:text-3xl">
            {checkIn.title}
          </h1>
          <CheckInStatusBadge
            status={checkIn.status}
            pendingTransition={checkIn.pendingTransition}
          />
        </div>

        {checkIn.completedAt && (
          <p className="text-sm text-text-secondary">
            Completed{' '}
            {checkIn.completedAt.toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        )}
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowReopenDialog(true)}
          disabled={hasPendingReopen}
        >
          <HiArrowPath className="h-4 w-4" />
          Re-open
        </Button>

        <Button variant="secondary" size="sm" disabled title="Coming soon">
          <HiSparkles className="h-4 w-4" />
          Summarize with AI
        </Button>
      </div>

      {/* Pending transition banner */}
      {hasPendingReopen && (
        <PendingTransitionBanner
          pendingTransition="reopen"
          isInitiator={isInitiator}
          partnerName={isInitiator ? partnerName : pendingByName}
          onConfirm={async () => {
            const result = await confirmTransition(checkIn.id)
            if (result.success) router.refresh()
            return result
          }}
          onCancel={async () => {
            const result = await cancelTransition(checkIn.id)
            if (result.success) router.refresh()
            return result
          }}
        />
      )}

      {/* Divider */}
      <hr className="border-border-subtle" />

      {/* Questions with both partners' answers (read-only) */}
      <div className="flex flex-col gap-8">
        {checkIn.questions.map((q, index) => {
          const questionActionItems = actionItemsByQuestion[q.id] ?? []

          return (
            <div key={q.id} className="flex flex-col gap-3">
              {/* Question heading (outside the card) */}
              <div className="flex items-center gap-3">
                <span
                  className={cns(
                    'flex h-7 w-7 shrink-0 items-center justify-center',
                    'rounded-full bg-primary-500 text-sm font-bold text-text-inverse',
                  )}
                >
                  {index + 1}
                </span>
                <p className="text-2xl font-semibold text-text">
                  {q.questionText}
                </p>
              </div>

              {/* Response card */}
              <div
                className={cns(
                  'flex flex-col gap-4 rounded-md border border-border-subtle',
                  'bg-bg-raised p-4',
                )}
              >
                {/* Your answer */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-text-secondary">
                    {userDisplayName}&apos;s answer
                  </span>
                  <div
                    className={cns(
                      'min-h-[80px] w-full rounded-sm border border-border',
                      'bg-bg-surface px-3 py-2 text-sm text-text',
                    )}
                  >
                    {userResponses[q.id] ? (
                      <p className="whitespace-pre-wrap">
                        {userResponses[q.id]}
                      </p>
                    ) : (
                      <p className="text-text-muted italic">No response</p>
                    )}
                  </div>
                </div>

                {/* Partner's answer */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-text-secondary">
                    {partnerDisplayName}&apos;s answer
                  </span>
                  <div
                    className={cns(
                      'min-h-[80px] w-full rounded-sm border border-border',
                      'bg-bg-surface px-3 py-2 text-sm text-text',
                    )}
                  >
                    {partnerResponses[q.id] ? (
                      <p className="whitespace-pre-wrap">
                        {partnerResponses[q.id]}
                      </p>
                    ) : (
                      <p className="text-text-muted italic">No response</p>
                    )}
                  </div>
                </div>

                {/* Action items for this question */}
                {questionActionItems.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <hr className="border-border-subtle" />
                    <span className="text-xs font-medium text-text-secondary">
                      Action items
                    </span>
                    <ActionItemList
                      actionItems={questionActionItems}
                      userId={userId}
                      checkInStatus={checkIn.status}
                      showEmpty
                    />
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Error */}
      {error && <p className="text-sm text-error animate-fade-in">{error}</p>}

      {/* Re-open confirmation dialog */}
      {showReopenDialog && (
        <Dialog
          open
          onClose={() => setShowReopenDialog(false)}
          loading={reopening}
          aria-labelledby="reopen-checkin-dialog-title"
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-900">
                <HiArrowPath className="h-6 w-6 text-primary-300" />
              </div>

              <h2
                id="reopen-checkin-dialog-title"
                className="text-lg font-semibold text-text"
              >
                Re-open check-in?
              </h2>

              <p className="text-sm text-text-secondary">
                Re-opening this check-in will make answers editable again. You
                can complete it again when you&apos;re ready.
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
                onClick={() => setShowReopenDialog(false)}
                disabled={reopening}
              >
                Cancel
              </Button>

              <Button
                className="flex-1"
                onClick={handleReopen}
                loading={reopening}
              >
                {reopening ? 'Re-opening...' : 'Re-open'}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}
