import { cns } from '@lilnas/utils/cns'
import { motion } from 'motion/react'
import { useMemo } from 'react'
import { useLocalStorage } from 'usehooks-ts'

import {
  CARB_SIZE_OPTIONS,
  getCarbSizeLabel,
  getProteinSizeLabel,
  NUTRITION_DATA,
  PROTEIN_SIZE_OPTIONS,
} from 'src/data/nutritionData'
import type { CarbSize, ProteinSize } from 'src/types/nutrition'
import { calculateMacrosWithBreakdown } from 'src/utils/calculations'

import { MacroDisplay } from './MacroDisplay'
import { SelectDropdown } from './SelectDropdown'
import { ThemeToggle } from './ThemeToggle'

interface MealSelections {
  protein: string
  proteinSize: ProteinSize
  flavor: string
  carb: string
  carbSize: CarbSize
  veggie: string
}

export const MealCalculator = () => {
  // State for selections - persisted to localStorage
  const [selections, setSelections] = useLocalStorage<MealSelections>(
    'meal-selections',
    {
      protein: NUTRITION_DATA.proteins[0].name,
      proteinSize: 6,
      flavor: NUTRITION_DATA.proteinFlavors[0].name,
      carb: NUTRITION_DATA.carbs[0].name,
      carbSize: 'full',
      veggie: NUTRITION_DATA.veggies[0].name,
    },
  )

  // Helper functions to update individual fields
  const setSelectedProtein = (protein: string) => {
    setSelections(prev => ({ ...prev, protein }))
  }

  const setSelectedProteinSize = (proteinSize: ProteinSize) => {
    setSelections(prev => ({ ...prev, proteinSize }))
  }

  const setSelectedFlavor = (flavor: string) => {
    setSelections(prev => ({ ...prev, flavor }))
  }

  const setSelectedCarb = (carb: string) => {
    setSelections(prev => ({ ...prev, carb }))
  }

  const setSelectedCarbSize = (carbSize: CarbSize) => {
    setSelections(prev => ({ ...prev, carbSize }))
  }

  const setSelectedVeggie = (veggie: string) => {
    setSelections(prev => ({ ...prev, veggie }))
  }

  // Get selected items
  const protein = useMemo(
    () =>
      NUTRITION_DATA.proteins.find(p => p.name === selections.protein) || null,
    [selections.protein],
  )

  const flavor = useMemo(
    () =>
      NUTRITION_DATA.proteinFlavors.find(f => f.name === selections.flavor) ||
      null,
    [selections.flavor],
  )

  const carb = useMemo(
    () => NUTRITION_DATA.carbs.find(c => c.name === selections.carb) || null,
    [selections.carb],
  )

  const veggie = useMemo(
    () =>
      NUTRITION_DATA.veggies.find(v => v.name === selections.veggie) || null,
    [selections.veggie],
  )

  // Calculate macros with breakdown
  const macrosWithBreakdown = useMemo(
    () =>
      calculateMacrosWithBreakdown(
        protein,
        selections.proteinSize,
        flavor,
        carb,
        selections.carbSize,
        veggie,
      ),
    [
      protein,
      selections.proteinSize,
      flavor,
      carb,
      selections.carbSize,
      veggie,
    ],
  )

  // Prepare options for dropdowns
  const proteinOptions = NUTRITION_DATA.proteins.map(p => ({
    value: p.name,
    label: p.name,
  }))

  const proteinSizeOptionsFormatted = PROTEIN_SIZE_OPTIONS.map(size => ({
    value: String(size),
    label: getProteinSizeLabel(size),
  }))

  const flavorOptions = NUTRITION_DATA.proteinFlavors.map(f => ({
    value: f.name,
    label: f.name,
  }))

  const carbOptions = NUTRITION_DATA.carbs.map(c => ({
    value: c.name,
    label: c.name,
  }))

  const carbSizeOptionsFormatted = CARB_SIZE_OPTIONS.map(size => ({
    value: size,
    label: getCarbSizeLabel(size),
  }))

  const veggieOptions = NUTRITION_DATA.veggies.map(v => ({
    value: v.name,
    label: v.name,
  }))

  return (
    <div
      className={cns(
        'min-h-screen bg-gradient-to-br px-4 py-12',
        'from-purple-100 via-blue-50 to-pink-100',
        'dark:from-gray-900 dark:via-gray-800 dark:to-gray-900',
      )}
    >
      <ThemeToggle />
      <div className={cns('mx-auto max-w-6xl')}>
        <motion.div
          initial={{ opacity: 0, y: -30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className={cns('mb-12 text-center')}
        >
          <h1
            className={cns(
              'bg-gradient-to-r bg-clip-text text-5xl font-bold text-transparent',
              'from-purple-600 via-blue-600 to-pink-600',
              'dark:from-purple-400 dark:via-blue-400 dark:to-pink-400',
              'md:text-6xl',
            )}
          >
            Macro Calculator
          </h1>
          <p className={cns('mt-4 text-lg text-gray-600 dark:text-gray-300')}>
            Build your perfect meal and track your macros
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className={cns(
            'rounded-2xl bg-white/80 p-8 shadow-2xl backdrop-blur-sm',
            'dark:bg-gray-800/80',
          )}
        >
          <div
            className={cns(
              'grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3',
            )}
          >
            <SelectDropdown
              label="Protein Type"
              value={selections.protein}
              onValueChange={setSelectedProtein}
              options={proteinOptions}
              placeholder="Select protein"
            />

            <SelectDropdown
              label="Protein Size"
              value={String(selections.proteinSize)}
              onValueChange={value =>
                setSelectedProteinSize(Number(value) as ProteinSize)
              }
              options={proteinSizeOptionsFormatted}
              placeholder="Select size"
            />

            <SelectDropdown
              label="Protein Flavor"
              value={selections.flavor}
              onValueChange={setSelectedFlavor}
              options={flavorOptions}
              placeholder="Select flavor"
            />

            <SelectDropdown
              label="Carb"
              value={selections.carb}
              onValueChange={setSelectedCarb}
              options={carbOptions}
              placeholder="Select carb"
            />

            <SelectDropdown
              label="Carb Size"
              value={selections.carbSize}
              onValueChange={value => setSelectedCarbSize(value as CarbSize)}
              options={carbSizeOptionsFormatted}
              placeholder="Select size"
            />

            <SelectDropdown
              label="Veggies"
              value={selections.veggie}
              onValueChange={setSelectedVeggie}
              options={veggieOptions}
              placeholder="Select veggie"
            />
          </div>

          <MacroDisplay macrosWithBreakdown={macrosWithBreakdown} />
        </motion.div>
      </div>
    </div>
  )
}
