export interface NutritionItem {
  name: string
  calories: number
  carbs: number
  fat: number
  protein: number
  fiber: number
  sugar: number
}

export interface NutritionData {
  proteins: NutritionItem[]
  proteinFlavors: NutritionItem[]
  carbs: NutritionItem[]
  veggies: NutritionItem[]
}

export interface CalculatedMacros {
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  sugar: number
}

export interface ComponentMacros {
  name: string
  type: 'protein' | 'flavor' | 'carb' | 'veggie'
  size: string
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  sugar: number
}

export interface MacrosWithBreakdown {
  totals: CalculatedMacros
  breakdown: ComponentMacros[]
}

export type ProteinSize = 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

export type CarbSize = 'full' | 'half'
