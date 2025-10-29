import type {
  CalculatedMacros,
  CarbSize,
  ComponentMacros,
  MacrosWithBreakdown,
  NutritionItem,
  ProteinSize,
} from 'src/types/nutrition'

export const calculateMacros = (
  protein: NutritionItem | null,
  proteinSize: ProteinSize,
  flavor: NutritionItem | null,
  carb: NutritionItem | null,
  carbSize: CarbSize,
  veggie: NutritionItem | null,
): CalculatedMacros => {
  const result: CalculatedMacros = {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    fiber: 0,
    sugar: 0,
  }

  // Add protein (multiplied by size since base is per 1oz)
  if (protein) {
    result.calories += protein.calories * proteinSize
    result.protein += protein.protein * proteinSize
    result.carbs += protein.carbs * proteinSize
    result.fat += protein.fat * proteinSize
    result.fiber += protein.fiber * proteinSize
    result.sugar += protein.sugar * proteinSize
  }

  // Add flavor
  if (flavor) {
    result.calories += flavor.calories
    result.protein += flavor.protein
    result.carbs += flavor.carbs
    result.fat += flavor.fat
    result.fiber += flavor.fiber
    result.sugar += flavor.sugar
  }

  // Add carb (multiplied by size)
  if (carb) {
    const carbMultiplier = carbSize === 'half' ? 0.5 : 1
    result.calories += carb.calories * carbMultiplier
    result.protein += carb.protein * carbMultiplier
    result.carbs += carb.carbs * carbMultiplier
    result.fat += carb.fat * carbMultiplier
    result.fiber += carb.fiber * carbMultiplier
    result.sugar += carb.sugar * carbMultiplier
  }

  // Add veggie
  if (veggie) {
    result.calories += veggie.calories
    result.protein += veggie.protein
    result.carbs += veggie.carbs
    result.fat += veggie.fat
    result.fiber += veggie.fiber
    result.sugar += veggie.sugar
  }

  return result
}

export const calculateMacrosWithBreakdown = (
  protein: NutritionItem | null,
  proteinSize: ProteinSize,
  flavor: NutritionItem | null,
  carb: NutritionItem | null,
  carbSize: CarbSize,
  veggie: NutritionItem | null,
): MacrosWithBreakdown => {
  const breakdown: ComponentMacros[] = []

  // Add protein to breakdown (multiplied by size since base is per 1oz)
  if (protein) {
    breakdown.push({
      name: protein.name.replace(/\s*\(1\s*oz\)/i, ''),
      type: 'protein',
      size: `${proteinSize} oz`,
      calories: roundMacroValue(protein.calories * proteinSize),
      protein: roundMacroValue(protein.protein * proteinSize),
      carbs: roundMacroValue(protein.carbs * proteinSize),
      fat: roundMacroValue(protein.fat * proteinSize),
      fiber: roundMacroValue(protein.fiber * proteinSize),
      sugar: roundMacroValue(protein.sugar * proteinSize),
    })
  }

  // Add flavor to breakdown
  if (flavor) {
    const sizeMatch = flavor.name.match(/\((.*?)\)/)
    const extractedSize = sizeMatch ? sizeMatch[1] : '1 serving'
    const cleanName = flavor.name.replace(/\s*\(.*?\)/, '')

    breakdown.push({
      name: cleanName,
      type: 'flavor',
      size: extractedSize,
      calories: roundMacroValue(flavor.calories),
      protein: roundMacroValue(flavor.protein),
      carbs: roundMacroValue(flavor.carbs),
      fat: roundMacroValue(flavor.fat),
      fiber: roundMacroValue(flavor.fiber),
      sugar: roundMacroValue(flavor.sugar),
    })
  }

  // Add carb to breakdown (multiplied by size)
  if (carb) {
    const carbMultiplier = carbSize === 'half' ? 0.5 : 1
    breakdown.push({
      name: carb.name,
      type: 'carb',
      size: carbSize === 'half' ? 'Half Serving' : 'Full Serving',
      calories: roundMacroValue(carb.calories * carbMultiplier),
      protein: roundMacroValue(carb.protein * carbMultiplier),
      carbs: roundMacroValue(carb.carbs * carbMultiplier),
      fat: roundMacroValue(carb.fat * carbMultiplier),
      fiber: roundMacroValue(carb.fiber * carbMultiplier),
      sugar: roundMacroValue(carb.sugar * carbMultiplier),
    })
  }

  // Add veggie to breakdown
  if (veggie) {
    const sizeMatch = veggie.name.match(/\((.*?)\)/)
    const extractedSize = sizeMatch ? sizeMatch[1] : '1 serving'
    const cleanName = veggie.name.replace(/\s*\(.*?\)/, '')

    breakdown.push({
      name: cleanName,
      type: 'veggie',
      size: extractedSize,
      calories: roundMacroValue(veggie.calories),
      protein: roundMacroValue(veggie.protein),
      carbs: roundMacroValue(veggie.carbs),
      fat: roundMacroValue(veggie.fat),
      fiber: roundMacroValue(veggie.fiber),
      sugar: roundMacroValue(veggie.sugar),
    })
  }

  // Calculate totals
  const totals = calculateMacros(
    protein,
    proteinSize,
    flavor,
    carb,
    carbSize,
    veggie,
  )

  return { totals, breakdown }
}

export const formatMacroValue = (value: number, decimals = 1): string => {
  return value.toFixed(decimals)
}

export const roundMacroValue = (value: number): number => {
  return Math.round(value * 10) / 10
}
