'use client'

import { cns } from '@lilnas/utils/cns'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import { HiArrowLeft, HiCheckCircle } from 'react-icons/hi2'

import { completeCheckIn, saveResponse } from 'src/app/(app)/check-ins/actions'
import type { ActionItem, CheckInDetail } from 'src/app/(app)/check-ins/types'
import { ActionItemForm } from 'src/components/action-item-form'
import { ActionItemList } from 'src/components/action-item-list'
import { CheckInStatusBadge } from 'src/components/check-in-status-badge'
import { ResponseInput } from 'src/components/response-input'
import { Button } from 'src/components/ui/button'
import { Dialog } from 'src/components/ui/dialog'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CheckInActiveViewProps {
  checkIn: CheckInDetail
  userId: string
  actionItems: ActionItem[]
}

// ---------------------------------------------------------------------------
// CheckInActiveView
// ---------------------------------------------------------------------------

export function CheckInActiveView({
  checkIn,
  userId,
  actionItems,
}: CheckInActiveViewProps) {
  const router = useRouter()

  // Derive partner info from responses
  const partnerInfo = useMemo(() => {
    const partnerResponse = checkIn.responses.find(r => r.userId !== userId)
    return partnerResponse
      ? {
          id: partnerResponse.userId,
          displayName: partnerResponse.displayName,
        }
      : null
  }, [checkIn.responses, userId])

  // Build user response map: questionId -> responseText
  const initialUserResponses: Record<string, string> = {}

  for (const r of checkIn.responses) {
    if (r.userId === userId) {
      initialUserResponses[r.checkInQuestionId] = r.responseText ?? ''
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

  const [userResponses, setUserResponses] =
    useState<Record<string, string>>(initialUserResponses)
  const [showCompleteDialog, setShowCompleteDialog] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleResponseChange = useCallback(
    (questionId: string, value: string) => {
      setUserResponses(prev => ({ ...prev, [questionId]: value }))
    },
    [],
  )

  const handleAutoSave = useCallback(
    async (questionId: string, value: string) => {
      await saveResponse(questionId, value)
    },
    [],
  )

  const handleComplete = useCallback(async () => {
    setError(null)
    setCompleting(true)

    const result = await completeCheckIn(checkIn.id)

    if (result.success) {
      setShowCompleteDialog(false)
      router.refresh()
    } else {
      setError(result.error)
      setCompleting(false)
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
          <CheckInStatusBadge status={checkIn.status} />
        </div>

        {checkIn.startedAt && (
          <p className="text-sm text-text-secondary">
            Started{' '}
            {checkIn.startedAt.toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        )}
      </div>

      {/* Questions with your answers only */}
      <div className="flex flex-col gap-6">
        {checkIn.questions.map((q, index) => {
          const questionActionItems = actionItemsByQuestion[q.id] ?? []

          return (
            <div
              key={q.id}
              className={cns(
                'flex flex-col gap-4 rounded-md border border-border-subtle',
                'bg-bg-raised p-4',
              )}
            >
              {/* Question text */}
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-sm font-bold text-primary-400 tabular-nums">
                  {index + 1}.
                </span>
                <p className="text-sm font-medium text-text">
                  {q.questionText}
                </p>
              </div>

              {/* Your answer (editable) */}
              <ResponseInput
                value={userResponses[q.id] ?? ''}
                onValueChange={value => handleResponseChange(q.id, value)}
                onAutoSave={value => handleAutoSave(q.id, value)}
                placeholder="Write your answer..."
              />

              {/* Action items section */}
              {(questionActionItems.length > 0 || partnerInfo) && (
                <div className="flex flex-col gap-3">
                  {questionActionItems.length > 0 && (
                    <>
                      <hr className="border-border-subtle" />
                      <span className="text-xs font-medium text-text-secondary">
                        Action items
                      </span>
                      <ActionItemList
                        actionItems={questionActionItems}
                        userId={userId}
                        checkInStatus={checkIn.status}
                      />
                    </>
                  )}

                  {/* Add action item form */}
                  {partnerInfo && (
                    <>
                      {questionActionItems.length === 0 && (
                        <hr className="border-border-subtle" />
                      )}
                      <ActionItemForm
                        checkInId={checkIn.id}
                        questionId={q.id}
                        userId={userId}
                        partnerName={partnerInfo.displayName}
                        partnerId={partnerInfo.id}
                      />
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Error */}
      {error && <p className="text-sm text-error animate-fade-in">{error}</p>}

      {/* Complete button */}
      <Button
        type="button"
        size="lg"
        className="w-full"
        onClick={() => setShowCompleteDialog(true)}
      >
        <HiCheckCircle className="h-4 w-4" />
        Complete Check-in
      </Button>

      {/* Complete confirmation dialog */}
      {showCompleteDialog && (
        <Dialog
          open
          onClose={() => setShowCompleteDialog(false)}
          loading={completing}
          aria-labelledby="complete-checkin-dialog-title"
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success-muted">
                <HiCheckCircle className="h-6 w-6 text-success" />
              </div>

              <h2
                id="complete-checkin-dialog-title"
                className="text-lg font-semibold text-text"
              >
                Complete check-in?
              </h2>

              <p className="text-sm text-text-secondary">
                Completing this check-in will make all answers read-only. You
                can re-open it later if needed.
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
                onClick={() => setShowCompleteDialog(false)}
                disabled={completing}
              >
                Cancel
              </Button>

              <Button
                className="flex-1"
                onClick={handleComplete}
                loading={completing}
              >
                {completing ? 'Completing...' : 'Complete'}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}
