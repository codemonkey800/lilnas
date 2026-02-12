'use client'

import { cns } from '@lilnas/utils/cns'
import { useCallback, useMemo, useState, useTransition } from 'react'
import { HiPlus } from 'react-icons/hi2'

import { createActionItem } from 'src/app/(app)/check-ins/action-item.actions'
import type { ActionItemOwnerType } from 'src/app/(app)/check-ins/types'

import { Button } from './ui/button'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ActionItemFormProps {
  checkInId: string
  questionId: string
  userId: string
  partnerName: string
  partnerId: string
}

// ---------------------------------------------------------------------------
// Owner option type
// ---------------------------------------------------------------------------

interface OwnerOption {
  label: string
  ownerType: ActionItemOwnerType
  ownerId?: string
}

// ---------------------------------------------------------------------------
// ActionItemForm
// ---------------------------------------------------------------------------

export function ActionItemForm({
  checkInId,
  questionId,
  userId,
  partnerName,
  partnerId,
}: ActionItemFormProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [selectedOwner, setSelectedOwner] = useState<OwnerOption>({
    label: 'Me',
    ownerType: 'individual',
    ownerId: userId,
  })
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const ownerOptions: OwnerOption[] = useMemo(
    () => [
      { label: 'Me', ownerType: 'individual', ownerId: userId },
      { label: partnerName, ownerType: 'individual', ownerId: partnerId },
      { label: 'Both of us', ownerType: 'both' },
    ],
    [userId, partnerName, partnerId],
  )

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      setError(null)

      const trimmed = description.trim()
      if (!trimmed) {
        setError('Description is required.')
        return
      }

      startTransition(async () => {
        const result = await createActionItem({
          checkInId,
          checkInQuestionId: questionId,
          description: trimmed,
          ownerType: selectedOwner.ownerType,
          ownerId: selectedOwner.ownerId,
        })

        if (result.success) {
          setDescription('')
          setSelectedOwner(ownerOptions[0]!)
          setIsOpen(false)
          setError(null)
        } else {
          setError(result.error)
        }
      })
    },
    [description, checkInId, questionId, selectedOwner, ownerOptions],
  )

  const handleCancel = useCallback(() => {
    setIsOpen(false)
    setDescription('')
    setError(null)
    setSelectedOwner({
      label: 'Me',
      ownerType: 'individual',
      ownerId: userId,
    })
  }, [userId])

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={cns(
          'inline-flex items-center gap-1.5 self-start rounded-sm px-2 py-1',
          'text-xs font-medium text-text-secondary',
          'transition-colors duration-150 ease-smooth',
          'hover:bg-bg-surface hover:text-text',
          'focus-visible:shadow-focus',
        )}
      >
        <HiPlus className="h-3.5 w-3.5" />
        Add action item
      </button>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cns(
        'flex flex-col gap-3 rounded-sm border border-border-subtle',
        'bg-bg-surface p-3 animate-fade-in',
      )}
    >
      {/* Description input */}
      <input
        type="text"
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="What needs to be done?"
        maxLength={500}
        autoFocus
        className={cns(
          'w-full rounded-sm border border-border bg-bg-raised px-3 py-2',
          'text-sm text-text placeholder:text-text-muted',
          'transition-colors duration-150 ease-smooth',
          'focus:border-primary focus:outline-none focus-visible:shadow-focus',
        )}
      />

      {/* Owner selector */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-text-secondary">
          Assign to
        </span>
        <div className="flex flex-wrap gap-1.5">
          {ownerOptions.map(option => {
            const isSelected =
              option.ownerType === selectedOwner.ownerType &&
              option.ownerId === selectedOwner.ownerId
            return (
              <button
                key={option.label}
                type="button"
                onClick={() => setSelectedOwner(option)}
                className={cns(
                  'inline-flex items-center rounded-full px-2.5 py-0.5',
                  'text-xs font-medium',
                  'transition-colors duration-150 ease-smooth',
                  'focus-visible:shadow-focus',
                  isSelected
                    ? 'bg-primary-900 text-primary-300'
                    : 'bg-bg-overlay text-text-secondary hover:text-text',
                )}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Error */}
      {error && <p className="text-xs text-error animate-fade-in">{error}</p>}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={isPending}>
          {isPending ? 'Adding...' : 'Add'}
        </Button>
      </div>
    </form>
  )
}
