'use client'

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { cns } from '@lilnas/utils/cns'
import AddIcon from '@mui/icons-material/Add'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useRouter } from 'next/navigation'
import { useCallback, useRef, useState, useTransition } from 'react'

import type { ActionResult } from 'src/actions/sessions'
import { type DayCode } from 'src/db/schema'
import type { RoutineRow } from 'src/db/types'
import { useToast } from 'src/hooks/use-toast'
import { mapCreateRoutineError } from 'src/lib/format'
import {
  applyTypeSwitch,
  canonicalizeDays,
  createEmptyCard,
  type ExerciseCardState,
  isRoutineFormValid,
  normalizeCard,
  type RoutineFormValues,
} from 'src/lib/routine-form'

import { DayPicker } from './DayPicker'
import { ExerciseCard } from './ExerciseCard'

export type RoutineFormProps = {
  initialValues: {
    name: string
    days: DayCode[]
    cards: ExerciseCardState[]
  }
  submitAction: (values: RoutineFormValues) => Promise<ActionResult<RoutineRow>>
  // Defaults to 'Create routine' so the edit page can pass 'Save changes'
  submitLabel?: string
}

export function RoutineForm({
  initialValues,
  submitAction,
  submitLabel = 'Create routine',
}: RoutineFormProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [isPending, startTransition] = useTransition()

  const [name, setName] = useState(initialValues.name)
  const [selectedDays, setSelectedDays] = useState<Set<DayCode>>(
    () => new Set(initialValues.days),
  )
  const [cards, setCards] = useState<ExerciseCardState[]>(initialValues.cards)
  const [submitAttempted, setSubmitAttempted] = useState(false)

  // Tracks which card fields have been blurred so we only show errors there
  // until a submit attempt, after which all errors show.
  const [touched, setTouched] = useState<Record<string, Set<string>>>({})

  // Stores actual input DOM elements keyed by card id for focus management.
  // Accessed only in event handlers, never during render.
  const nameInputs = useRef<Record<string, HTMLInputElement | null>>({})

  const registerNameInput = useCallback(
    (id: string) => (el: HTMLInputElement | null) => {
      nameInputs.current[id] = el
    },
    [],
  )

  // Pointer drag starts only after an 8px move so a tap on the grip doesn't
  // begin a drag; keyboard sensor makes the grip operable (Space, arrows, Space).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const canSubmit = isRoutineFormValid({ name, cards })

  // ─── Day handlers ─────────────────────────────────────────────────────────

  const handleToggleDay = useCallback((code: DayCode) => {
    setSelectedDays(prev => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }, [])

  // ─── Card handlers ─────────────────────────────────────────────────────────

  const handleAddCard = useCallback(() => {
    const card = createEmptyCard()
    setCards(prev => [...prev, card])
    // Move focus to the new card's name field after React commits the new card
    requestAnimationFrame(() => {
      nameInputs.current[card.id]?.focus()
    })
  }, [])

  const handleRemoveCard = useCallback((id: string) => {
    setCards(prev => {
      const idx = prev.findIndex(c => c.id === id)
      const next = prev.filter(c => c.id !== id)
      // Move focus to the previous card's name input (or none if list empties)
      requestAnimationFrame(() => {
        const targetId = next[Math.max(0, idx - 1)]?.id
        if (targetId) nameInputs.current[targetId]?.focus()
      })
      return next
    })
    delete nameInputs.current[id]
    setTouched(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setCards(prev => {
      const from = prev.findIndex(c => c.id === active.id)
      const to = prev.findIndex(c => c.id === over.id)
      if (from < 0 || to < 0) return prev
      return arrayMove(prev, from, to)
    })
  }, [])

  const handleTypeChange = useCallback(
    (id: string, type: ExerciseCardState['type']) => {
      setCards(prev =>
        prev.map(c => (c.id === id ? applyTypeSwitch(c, type) : c)),
      )
      // Clear errors for now-hidden fields
      setTouched(prev => ({
        ...prev,
        [id]: new Set(),
      }))
    },
    [],
  )

  const handlePatchCard = useCallback(
    (id: string, patch: Partial<ExerciseCardState>) => {
      setCards(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)))
    },
    [],
  )

  // ─── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(() => {
    setSubmitAttempted(true)
    if (!canSubmit) return

    startTransition(async () => {
      // Build validated exercises from cards
      const exercises = cards.map(c => {
        const r = normalizeCard(c)
        if (!r.ok) throw new Error('invalid card state')
        return r.draft
      })

      const values: RoutineFormValues = {
        name: name.trim(),
        days: canonicalizeDays(selectedDays),
        exercises,
      }

      const result = await submitAction(values)
      if (!result.ok) {
        const { message, severity } = mapCreateRoutineError(result)
        showToast(message, severity)
        return
      }
      router.push('/')
    })
  }, [canSubmit, cards, name, selectedDays, submitAction, router, showToast])

  const handleCancel = useCallback(() => {
    router.push('/')
  }, [router])

  // ─── Derived error state ───────────────────────────────────────────────────

  function getCardErrors(card: ExerciseCardState) {
    if (!submitAttempted) return {}
    const r = normalizeCard(card)
    return r.ok ? {} : r.errors
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const nameTouched = touched['__name__']?.has('name')
  const nameError =
    (submitAttempted || nameTouched) && name.trim() === ''
      ? 'Name is required'
      : undefined

  return (
    <div className="flex flex-col gap-6">
      {/* Form header */}
      <div className="flex items-center justify-between">
        <Typography variant="h6" component="h1" className="!font-bold">
          {submitLabel === 'Create routine' ? 'New routine' : 'Edit routine'}
        </Typography>
        <Button
          variant="text"
          onClick={handleCancel}
          disabled={isPending}
          className="!text-neutral-400 hover:!text-white"
        >
          Cancel
        </Button>
      </div>

      {/* Name field */}
      <div>
        <TextField
          label="Routine name"
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={() =>
            setTouched(prev => ({
              ...prev,
              __name__: new Set(['name']),
            }))
          }
          error={!!nameError}
          helperText={nameError}
          size="small"
          fullWidth
          disabled={isPending}
          InputLabelProps={{ className: '!text-neutral-400' }}
          InputProps={{ className: '!text-neutral-200' }}
          sx={{
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: 'rgb(64 64 64)',
            },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: 'rgb(115 115 115)',
            },
          }}
        />
      </div>

      {/* Days picker */}
      <div className="flex flex-col gap-2">
        <Typography variant="body2" className="!text-neutral-400">
          Days (optional)
        </Typography>
        <DayPicker selected={selectedDays} onToggle={handleToggleDay} />
      </div>

      {/* Exercise cards */}
      <div className="flex flex-col gap-3">
        <Typography variant="body2" className="!text-neutral-400">
          Exercises
        </Typography>

        {cards.length === 0 && (
          <p className="text-sm text-neutral-500">
            Add at least one exercise to save.
          </p>
        )}

        <DndContext
          id="routine-exercises"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={cards.map(c => c.id)}
            strategy={verticalListSortingStrategy}
          >
            {cards.map(card => (
              <ExerciseCard
                key={card.id}
                card={card}
                errors={getCardErrors(card)}
                submitAttempted={submitAttempted}
                onChange={patch => handlePatchCard(card.id, patch)}
                onTypeChange={type => handleTypeChange(card.id, type)}
                onRemove={() => handleRemoveCard(card.id)}
                nameInputRef={registerNameInput(card.id)}
              />
            ))}
          </SortableContext>
        </DndContext>

        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={handleAddCard}
          disabled={isPending}
          fullWidth
          className={cns('!border-dashed !py-3 !text-neutral-400')}
        >
          Add exercise
        </Button>
      </div>

      {/* Submit */}
      <Button
        variant="contained"
        onClick={handleSubmit}
        disabled={!canSubmit || isPending}
        fullWidth
        className="!font-semibold"
      >
        {submitLabel}
      </Button>
    </div>
  )
}
