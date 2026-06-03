// Static exercise catalog for the routine builder. No 'use client' or
// 'server-only' — importable from both client components and server code.
// Import ExerciseCardState with `import type` to keep this bundle-safe.

import type { ExerciseCardState } from 'src/lib/routine-form'

// ─── Muscle group metadata ────────────────────────────────────────────────────

export type MuscleGroup =
  | 'legs-glutes'
  | 'back'
  | 'chest'
  | 'shoulders'
  | 'arms'
  | 'core'

export const MUSCLE_GROUP_ORDER: MuscleGroup[] = [
  'legs-glutes',
  'back',
  'chest',
  'shoulders',
  'arms',
  'core',
]

export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  'legs-glutes': 'Legs / Glutes',
  back: 'Back',
  chest: 'Chest',
  shoulders: 'Shoulders',
  arms: 'Arms',
  core: 'Core',
}

// Tailwind bg classes for the colored dot accent per group.
// Avoids orange-500 (app primary accent) to prevent confusion with interactive elements.
export const MUSCLE_GROUP_ACCENT: Record<MuscleGroup, string> = {
  'legs-glutes': 'bg-lime-500',
  back: 'bg-sky-500',
  chest: 'bg-rose-500',
  shoulders: 'bg-amber-400',
  arms: 'bg-violet-500',
  core: 'bg-emerald-500',
}

// ─── Catalog types ────────────────────────────────────────────────────────────

export type CatalogEntry = {
  name: string
  muscleGroup?: MuscleGroup
}

type ExerciseType = ExerciseCardState['type']

// ─── v1 Catalog contents ──────────────────────────────────────────────────────

export const EXERCISE_CATALOG: Record<ExerciseType, CatalogEntry[]> = {
  weighted: [
    // Legs / Glutes
    { name: 'Romanian Deadlifts (Barbell)', muscleGroup: 'legs-glutes' },
    { name: 'Dumbbell RDLs', muscleGroup: 'legs-glutes' },
    { name: 'Dumbbell Sumo Deadlift', muscleGroup: 'legs-glutes' },
    { name: 'Sumo Squats', muscleGroup: 'legs-glutes' },
    { name: 'Goblet Squats', muscleGroup: 'legs-glutes' },
    { name: 'Bulgarian Split Squats', muscleGroup: 'legs-glutes' },
    { name: 'Smith Squats', muscleGroup: 'legs-glutes' },
    { name: 'Hip Thrust', muscleGroup: 'legs-glutes' },
    { name: 'Frog Pumps', muscleGroup: 'legs-glutes' },
    { name: 'Leg Press', muscleGroup: 'legs-glutes' },
    { name: 'Leg Extension Machine', muscleGroup: 'legs-glutes' },
    { name: 'Leg Curl / Hamstring Curl', muscleGroup: 'legs-glutes' },
    { name: 'Cable Kickbacks', muscleGroup: 'legs-glutes' },
    { name: 'Glute Kickback Machine', muscleGroup: 'legs-glutes' },
    { name: 'Hip Abduction Machine', muscleGroup: 'legs-glutes' },
    { name: 'Hip Adduction Machine', muscleGroup: 'legs-glutes' },
    { name: 'Standing Cable Adduction', muscleGroup: 'legs-glutes' },
    { name: 'Back Extensions', muscleGroup: 'legs-glutes' },
    { name: 'Glute Bridge Machine', muscleGroup: 'legs-glutes' },
    { name: 'Cable Pull Throughs', muscleGroup: 'legs-glutes' },
    { name: 'Dumbbell Step-Ups', muscleGroup: 'legs-glutes' },
    { name: 'Reverse Lunges', muscleGroup: 'legs-glutes' },
    { name: 'Barbell Back Squat', muscleGroup: 'legs-glutes' },
    { name: 'Front Squat', muscleGroup: 'legs-glutes' },
    { name: 'Hack Squat (Machine)', muscleGroup: 'legs-glutes' },
    { name: 'Conventional Deadlift', muscleGroup: 'legs-glutes' },
    { name: 'Stiff-Leg Deadlift', muscleGroup: 'legs-glutes' },
    { name: 'Walking Lunges', muscleGroup: 'legs-glutes' },
    { name: 'Seated Calf Raise', muscleGroup: 'legs-glutes' },
    { name: 'Standing Calf Raise', muscleGroup: 'legs-glutes' },
    // Back
    { name: 'Lat Pulldowns', muscleGroup: 'back' },
    { name: 'Seated Cable Rows', muscleGroup: 'back' },
    { name: 'Seated Row Machine', muscleGroup: 'back' },
    { name: 'Dumbbell Rows', muscleGroup: 'back' },
    { name: 'Straight Arm Pulldowns', muscleGroup: 'back' },
    { name: 'Resistance Band Pulldowns', muscleGroup: 'back' },
    { name: 'Rear Delt Fly Machine', muscleGroup: 'back' },
    { name: 'Barbell Bent-Over Row', muscleGroup: 'back' },
    { name: 'T-Bar Row', muscleGroup: 'back' },
    { name: 'Dumbbell Shrugs', muscleGroup: 'back' },
    { name: 'Face Pulls', muscleGroup: 'back' },
    // Chest
    { name: 'Chest Press Machine', muscleGroup: 'chest' },
    { name: 'Chest Fly / Pec Deck Machine', muscleGroup: 'chest' },
    { name: 'Barbell Bench Press', muscleGroup: 'chest' },
    { name: 'Incline Dumbbell Press', muscleGroup: 'chest' },
    { name: 'Dumbbell Bench Press', muscleGroup: 'chest' },
    // Shoulders
    { name: 'Shoulder Press (Machine)', muscleGroup: 'shoulders' },
    { name: 'Overhead Press (Barbell)', muscleGroup: 'shoulders' },
    { name: 'Dumbbell Shoulder Press', muscleGroup: 'shoulders' },
    { name: 'Lateral Raises', muscleGroup: 'shoulders' },
    { name: 'Cable Lateral Raises', muscleGroup: 'shoulders' },
    { name: 'Front Raises', muscleGroup: 'shoulders' },
    // Arms
    { name: 'Tricep Pushdowns', muscleGroup: 'arms' },
    { name: 'Tricep Press Machine', muscleGroup: 'arms' },
    { name: 'Triceps Dips (Machine)', muscleGroup: 'arms' },
    { name: 'Tricep Kickbacks', muscleGroup: 'arms' },
    { name: 'Overhead Triceps Extension', muscleGroup: 'arms' },
    { name: 'Bicep Curls', muscleGroup: 'arms' },
    { name: 'Hammer Curls', muscleGroup: 'arms' },
    { name: 'Forearm Curls (Bar)', muscleGroup: 'arms' },
    { name: 'Preacher Curls Machine', muscleGroup: 'arms' },
    { name: 'Skull Crushers', muscleGroup: 'arms' },
    { name: 'Dumbbell Curl', muscleGroup: 'arms' },
    { name: 'Cable Bicep Curl', muscleGroup: 'arms' },
    // Core
    { name: 'Abdominal Crunch Machine', muscleGroup: 'core' },
    { name: 'Pallof Press', muscleGroup: 'core' },
    { name: 'Cable High-to-Low Woodchoppers', muscleGroup: 'core' },
    { name: 'Medicine Ball Slams', muscleGroup: 'core' },
    { name: 'Cable Crunches', muscleGroup: 'core' },
    { name: 'Weighted Russian Twists', muscleGroup: 'core' },
  ],

  bodyweight: [
    // Back
    { name: 'Assisted Pullups', muscleGroup: 'back' },
    { name: 'Pull-Ups', muscleGroup: 'back' },
    { name: 'Chin-Ups', muscleGroup: 'back' },
    // Chest
    { name: 'Push-Ups', muscleGroup: 'chest' },
    // Arms
    { name: 'Tricep Dips', muscleGroup: 'arms' },
    { name: 'Wrist Rotations', muscleGroup: 'arms' },
    // Legs / Glutes
    { name: 'Glute Bridges', muscleGroup: 'legs-glutes' },
    { name: 'Bodyweight Squats', muscleGroup: 'legs-glutes' },
    // Core
    { name: 'Bird Dog', muscleGroup: 'core' },
    { name: 'Supermans', muscleGroup: 'core' },
    { name: 'Mountain Climbers', muscleGroup: 'core' },
    { name: 'Bicycle Crunches', muscleGroup: 'core' },
    { name: 'Sit-Ups', muscleGroup: 'core' },
    { name: 'Lying Leg Raises', muscleGroup: 'core' },
    { name: 'Hanging Leg Raises', muscleGroup: 'core' },
  ],

  'time-based': [
    // Core
    { name: 'Vacuum Holds', muscleGroup: 'core' },
    { name: 'Plank', muscleGroup: 'core' },
    { name: 'Side Plank', muscleGroup: 'core' },
    { name: 'Hollow Body Hold', muscleGroup: 'core' },
    // Legs / Glutes
    { name: 'Wall Sit', muscleGroup: 'legs-glutes' },
    { name: 'Glute Bridge Hold', muscleGroup: 'legs-glutes' },
    // Back
    { name: 'Dead Hang', muscleGroup: 'back' },
  ],

  cardio: [
    { name: 'Stairmaster' },
    { name: 'Elliptical' },
    { name: 'Incline Treadmill' },
    { name: 'Treadmill Run' },
    { name: 'Stationary Bike' },
    { name: 'Rowing Machine' },
    { name: 'Jump Rope' },
    { name: 'Assault Bike' },
    { name: 'Walking' },
  ],
}

// ─── Duration defaults (R12) ──────────────────────────────────────────────────

// Raw string defaults written into the card's duration field on selection.
// time-based is seconds; cardio is minutes (normalizeCard converts at save).
export const DURATION_DEFAULTS: Partial<Record<ExerciseType, string>> = {
  'time-based': '30',
  cardio: '20',
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

// Returns the catalog entries for a given type, pre-sorted to satisfy MUI
// Autocomplete's groupBy ordering requirement (headers ordered by first
// appearance in the options array, so options must be group-sorted first).
// Non-cardio: sort by MUSCLE_GROUP_ORDER index, then alphabetically by name.
// Cardio: flat alphabetical list (no muscle groups).
export function optionsForType(type: ExerciseType): CatalogEntry[] {
  const entries = EXERCISE_CATALOG[type]
  if (type === 'cardio') {
    return [...entries].sort((a, b) => a.name.localeCompare(b.name))
  }
  return [...entries].sort((a, b) => {
    const ai = MUSCLE_GROUP_ORDER.indexOf(a.muscleGroup as MuscleGroup)
    const bi = MUSCLE_GROUP_ORDER.indexOf(b.muscleGroup as MuscleGroup)
    if (ai !== bi) return ai - bi
    return a.name.localeCompare(b.name)
  })
}

// Computes the card patch to apply when a catalog entry is selected (or cleared).
// entry === null (MUI clear "✕") → clears the name.
// Otherwise sets name, and for time-based/cardio adds the duration default only
// when the card's current duration is empty (empty-only guard, R12).
export function buildSelectionPatch(
  card: ExerciseCardState,
  entry: CatalogEntry | null,
): Partial<ExerciseCardState> {
  if (entry === null) {
    return { name: '' }
  }
  const base: Partial<ExerciseCardState> = { name: entry.name }
  const durationDefault = DURATION_DEFAULTS[card.type]
  if (durationDefault !== undefined && card.duration === '') {
    return { ...base, duration: durationDefault }
  }
  return base
}
