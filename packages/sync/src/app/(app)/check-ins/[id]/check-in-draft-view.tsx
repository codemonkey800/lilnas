'use client'

import { cns } from '@lilnas/utils/cns'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { HiArrowLeft, HiPlay } from 'react-icons/hi2'

import {
  cancelTransition,
  confirmTransition,
  saveResponse,
  startCheckIn,
} from 'src/app/(app)/check-ins/check-in.actions'
import type { CheckInDetail } from 'src/app/(app)/check-ins/types'
import { CheckInStatusBadge } from 'src/components/check-in-status-badge'
import { PendingTransitionBanner } from 'src/components/pending-transition-banner'
import { ResponseInput } from 'src/components/response-input'
import { Button } from 'src/components/ui/button'
import { Dialog } from 'src/components/ui/dialog'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CheckInDraftViewProps {
  checkIn: CheckInDetail
  userId: string
}

// ---------------------------------------------------------------------------
// CheckInDraftView
// ---------------------------------------------------------------------------

export function CheckInDraftView({ checkIn, userId }: CheckInDraftViewProps) {
  const router = useRouter()

  // Pending transition state
  const hasPendingStart = checkIn.pendingTransition === 'start'
  const isInitiator = checkIn.pendingTransitionById === userId
  const pendingByName = checkIn.pendingTransitionByName ?? 'Partner'
  const partnerName = checkIn.partnerDisplayName ?? 'Partner'

  // Build initial response state from server data
  const initialResponses: Record<string, string> = {}
  for (const r of checkIn.responses) {
    if (r.userId === userId) {
      initialResponses[r.checkInQuestionId] = r.responseText ?? ''
    }
  }

  const [responses, setResponses] =
    useState<Record<string, string>>(initialResponses)
  const [showStartDialog, setShowStartDialog] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Count answered questions (non-empty responses)
  const answeredCount = checkIn.questions.filter(
    q => (responses[q.id] ?? '').trim().length > 0,
  ).length
  const totalQuestions = checkIn.questions.length

  const handleResponseChange = useCallback(
    (questionId: string, value: string) => {
      setResponses(prev => ({ ...prev, [questionId]: value }))
    },
    [],
  )

  const handleAutoSave = useCallback(
    async (questionId: string, value: string) => {
      await saveResponse(questionId, value)
    },
    [],
  )

  const handleStart = useCallback(async () => {
    setError(null)
    setStarting(true)

    const result = await startCheckIn(checkIn.id)

    if (result.success) {
      setShowStartDialog(false)
      router.refresh()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      setError(result.error)
      setStarting(false)
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
      </div>

      {/* Progress indicator */}
      <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-raised px-4 py-3">
        <span className="text-sm text-text-secondary">
          You: {answeredCount}/{totalQuestions} answered
        </span>
      </div>

      {/* Pending transition banner */}
      {hasPendingStart && (
        <PendingTransitionBanner
          pendingTransition="start"
          isInitiator={isInitiator}
          partnerName={isInitiator ? partnerName : pendingByName}
          onConfirm={async () => {
            const result = await confirmTransition(checkIn.id)
            if (result.success) {
              router.refresh()
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }
            return result
          }}
          onCancel={async () => {
            const result = await cancelTransition(checkIn.id)
            if (result.success) {
              router.refresh()
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }
            return result
          }}
        />
      )}

      {/* Questions */}
      <div className="flex flex-col gap-8">
        {checkIn.questions.map((q, index) => (
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
                'flex flex-col gap-3 rounded-md border border-border-subtle',
                'bg-bg-raised p-4',
              )}
            >
              <ResponseInput
                value={responses[q.id] ?? ''}
                onValueChange={value => handleResponseChange(q.id, value)}
                onAutoSave={value => handleAutoSave(q.id, value)}
                placeholder="Write your answer..."
              />
            </div>
          </div>
        ))}
      </div>

      {/* Error */}
      {error && <p className="text-sm text-error animate-fade-in">{error}</p>}

      {/* Start button */}
      <Button
        type="button"
        size="lg"
        className="w-full"
        onClick={() => setShowStartDialog(true)}
        disabled={hasPendingStart}
      >
        <HiPlay className="h-4 w-4" />
        Start Check-in
      </Button>

      {/* Start confirmation dialog */}
      {showStartDialog && (
        <Dialog
          open
          onClose={() => setShowStartDialog(false)}
          loading={starting}
          aria-labelledby="start-checkin-dialog-title"
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-900">
                <HiPlay className="h-6 w-6 text-primary-300" />
              </div>

              <h2
                id="start-checkin-dialog-title"
                className="text-lg font-semibold text-text"
              >
                Start check-in?
              </h2>

              <p className="text-sm text-text-secondary">
                Starting this check-in will allow both partners to finalize
                answers and add action items. Answers will only be visible to
                both partners once the check-in is completed.
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
                onClick={() => setShowStartDialog(false)}
                disabled={starting}
              >
                Cancel
              </Button>

              <Button
                className="flex-1"
                onClick={handleStart}
                loading={starting}
              >
                {starting ? 'Starting...' : 'Start'}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}
