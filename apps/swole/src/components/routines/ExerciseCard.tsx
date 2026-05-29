'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cns } from '@lilnas/utils/cns'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import Autocomplete from '@mui/material/Autocomplete'
import FormControl from '@mui/material/FormControl'
import IconButton from '@mui/material/IconButton'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import TextField from '@mui/material/TextField'
import { useMemo } from 'react'

import type { CatalogEntry } from 'src/lib/exercise-catalog'
import {
  buildSelectionPatch,
  MUSCLE_GROUP_ACCENT,
  MUSCLE_GROUP_LABELS,
  optionsForType,
} from 'src/lib/exercise-catalog'
import type { CardFieldErrors, ExerciseCardState } from 'src/lib/routine-form'

export type ExerciseCardProps = {
  card: ExerciseCardState
  errors: CardFieldErrors
  submitAttempted: boolean
  onChange: (patch: Partial<ExerciseCardState>) => void
  onTypeChange: (type: ExerciseCardState['type']) => void
  onRemove: () => void
  // Callback ref so the parent can move focus to the name field on add
  nameInputRef?: (el: HTMLInputElement | null) => void
}

type ExerciseType = ExerciseCardState['type']

const EXERCISE_TYPE_LABELS: Record<ExerciseType, string> = {
  weighted: 'Weighted',
  bodyweight: 'Bodyweight',
  'time-based': 'Time-based',
  cardio: 'Cardio',
}

const OUTLINED_INPUT_SX = {
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: 'rgb(64 64 64)',
  },
  '&:hover .MuiOutlinedInput-notchedOutline': {
    borderColor: 'rgb(115 115 115)',
  },
}

export function ExerciseCard({
  card,
  errors,
  submitAttempted,
  onChange,
  onTypeChange,
  onRemove,
  nameInputRef,
}: ExerciseCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id })

  const showError = (field: keyof CardFieldErrors) =>
    submitAttempted ? errors[field] : undefined

  const options = useMemo(() => optionsForType(card.type), [card.type])
  const selectedValue = options.find(o => o.name === card.name) ?? null

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : undefined,
        zIndex: isDragging ? 1 : undefined,
      }}
      className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-4"
    >
      {/* Card header: drag handle + type selector + remove control */}
      <div className="mb-3 flex items-center gap-2">
        <IconButton
          ref={setActivatorNodeRef}
          size="small"
          aria-label="Drag to reorder exercise"
          {...attributes}
          {...listeners}
          className="!text-neutral-500 hover:!text-neutral-300"
          sx={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
        >
          <DragIndicatorIcon fontSize="small" />
        </IconButton>

        <FormControl size="small" className="min-w-[140px]">
          <InputLabel className="!text-neutral-400">Type</InputLabel>
          <Select
            value={card.type}
            label="Type"
            onChange={e => onTypeChange(e.target.value as ExerciseType)}
            className="!text-neutral-200"
            sx={{
              ...OUTLINED_INPUT_SX,
              '& .MuiSvgIcon-root': { color: 'rgb(163 163 163)' },
            }}
          >
            {(Object.keys(EXERCISE_TYPE_LABELS) as ExerciseType[]).map(t => (
              <MenuItem key={t} value={t}>
                {EXERCISE_TYPE_LABELS[t]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <IconButton
          size="small"
          onClick={onRemove}
          aria-label="Remove exercise"
          className="ml-auto !text-neutral-400 hover:!text-red-400"
        >
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </div>

      {/* Common fields */}
      <div className="flex flex-col gap-3">
        <Autocomplete<CatalogEntry, false, false, false>
          options={options}
          value={selectedValue}
          getOptionLabel={o => o.name}
          isOptionEqualToValue={(o, v) => o.name === v.name}
          groupBy={card.type !== 'cardio' ? o => o.muscleGroup! : undefined}
          renderGroup={params => (
            <li key={params.key}>
              <div className="flex items-center gap-2 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                <span
                  aria-hidden
                  className={cns(
                    'inline-block h-2 w-2 rounded-full',
                    MUSCLE_GROUP_ACCENT[
                      params.group as keyof typeof MUSCLE_GROUP_ACCENT
                    ],
                  )}
                />
                {
                  MUSCLE_GROUP_LABELS[
                    params.group as keyof typeof MUSCLE_GROUP_LABELS
                  ]
                }
              </div>
              <ul>{params.children}</ul>
            </li>
          )}
          noOptionsText="No matching exercise — add it to the catalog."
          onChange={(_, entry) => onChange(buildSelectionPatch(card, entry))}
          renderInput={params => (
            <TextField
              {...params}
              inputRef={nameInputRef}
              label="Exercise name"
              size="small"
              error={!!showError('name')}
              helperText={showError('name')}
              InputLabelProps={{
                ...params.InputLabelProps,
                className: '!text-neutral-400',
              }}
              InputProps={{
                ...params.InputProps,
                className: '!text-neutral-200',
              }}
              sx={OUTLINED_INPUT_SX}
            />
          )}
        />

        {/* Type-specific fields */}
        {card.type === 'weighted' && (
          <WeightedFields
            card={card}
            errors={errors}
            submitAttempted={submitAttempted}
            onChange={onChange}
          />
        )}
        {card.type === 'bodyweight' && (
          <BodyweightFields
            card={card}
            errors={errors}
            submitAttempted={submitAttempted}
            onChange={onChange}
          />
        )}
        {card.type === 'time-based' && (
          <TimeBasedFields
            card={card}
            errors={errors}
            submitAttempted={submitAttempted}
            onChange={onChange}
          />
        )}
        {card.type === 'cardio' && (
          <CardioFields
            card={card}
            errors={errors}
            submitAttempted={submitAttempted}
            onChange={onChange}
          />
        )}
      </div>
    </div>
  )
}

type FieldProps = {
  card: ExerciseCardState
  errors: CardFieldErrors
  submitAttempted: boolean
  onChange: (patch: Partial<ExerciseCardState>) => void
}

function numericFieldProps(
  label: string,
  value: string,
  error: string | undefined,
  onChangeFn: (v: string) => void,
) {
  return {
    label,
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      onChangeFn(e.target.value),
    error: !!error,
    helperText: error,
    size: 'small' as const,
    inputProps: { inputMode: 'numeric' as const },
    InputLabelProps: { className: '!text-neutral-400' },
    InputProps: { className: '!text-neutral-200' },
    sx: {
      '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgb(64 64 64)' },
      '&:hover .MuiOutlinedInput-notchedOutline': {
        borderColor: 'rgb(115 115 115)',
      },
    },
  }
}

function WeightedFields({
  card,
  errors,
  submitAttempted,
  onChange,
}: FieldProps) {
  const showError = (f: keyof CardFieldErrors) =>
    submitAttempted ? errors[f] : undefined
  return (
    <div className="grid grid-cols-2 gap-3">
      <TextField
        {...numericFieldProps('Sets', card.sets, showError('sets'), v =>
          onChange({ sets: v }),
        )}
      />
      <TextField
        {...numericFieldProps(
          'Target reps',
          card.targetReps,
          showError('targetReps'),
          v => onChange({ targetReps: v }),
        )}
      />
      <TextField
        {...numericFieldProps(
          'Starting weight (lb)',
          card.startingWeight,
          showError('startingWeight'),
          v => onChange({ startingWeight: v }),
        )}
      />
      <TextField
        {...numericFieldProps(
          'Increment (lb)',
          card.increment,
          showError('increment'),
          v => onChange({ increment: v }),
        )}
      />
    </div>
  )
}

function BodyweightFields({
  card,
  errors,
  submitAttempted,
  onChange,
}: FieldProps) {
  const showError = (f: keyof CardFieldErrors) =>
    submitAttempted ? errors[f] : undefined
  return (
    <div className="grid grid-cols-2 gap-3">
      <TextField
        {...numericFieldProps('Sets', card.sets, showError('sets'), v =>
          onChange({ sets: v }),
        )}
      />
      <TextField
        {...numericFieldProps(
          'Target reps',
          card.targetReps,
          showError('targetReps'),
          v => onChange({ targetReps: v }),
        )}
      />
    </div>
  )
}

function TimeBasedFields({
  card,
  errors,
  submitAttempted,
  onChange,
}: FieldProps) {
  const showError = (f: keyof CardFieldErrors) =>
    submitAttempted ? errors[f] : undefined
  return (
    <div className="grid grid-cols-2 gap-3">
      <TextField
        {...numericFieldProps('Sets', card.sets, showError('sets'), v =>
          onChange({ sets: v }),
        )}
      />
      <TextField
        {...numericFieldProps(
          'Duration (sec)',
          card.duration,
          showError('duration'),
          v => onChange({ duration: v }),
        )}
      />
    </div>
  )
}

function CardioFields({ card, errors, submitAttempted, onChange }: FieldProps) {
  const showError = (f: keyof CardFieldErrors) =>
    submitAttempted ? errors[f] : undefined
  return (
    <TextField
      {...numericFieldProps(
        'Duration (min)',
        card.duration,
        showError('duration'),
        v => onChange({ duration: v }),
      )}
      fullWidth
    />
  )
}
