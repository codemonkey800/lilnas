import type { CarbSize, NutritionData, ProteinSize } from 'src/types/nutrition'

export const PROTEIN_SIZE_OPTIONS: ProteinSize[] = [3, 4, 5, 6, 7, 8, 9, 10]

export const CARB_SIZE_OPTIONS: CarbSize[] = ['full', 'half']

export const getProteinSizeLabel = (size: ProteinSize): string => {
  return `${size} oz`
}

export const getCarbSizeLabel = (size: CarbSize): string => {
  switch (size) {
    case 'full':
      return 'Full Serving'
    case 'half':
      return 'Half Serving'
  }
}

/**
 * Base nutrition values.
 * - Proteins are per 1 oz (multiplied by the selected size in calculations).
 * - Carbs are per full serving (halved for half-serving in calculations).
 * - Flavors and veggies are per serving (used as-is).
 */
export const NUTRITION_DATA: NutritionData = {
  proteins: [
    {
      name: 'Chicken Breast (1 oz)',
      calories: 31,
      protein: 5.8,
      carbs: 0,
      fat: 0.7,
      fiber: 0,
      sugar: 0,
    },
    {
      name: 'Ground Turkey (1 oz)',
      calories: 36,
      protein: 4.6,
      carbs: 0,
      fat: 2,
      fiber: 0,
      sugar: 0,
    },
    {
      name: 'Steak (1 oz)',
      calories: 53,
      protein: 5.7,
      carbs: 0,
      fat: 3.2,
      fiber: 0,
      sugar: 0,
    },
    {
      name: 'Salmon (1 oz)',
      calories: 52,
      protein: 5.6,
      carbs: 0,
      fat: 3.2,
      fiber: 0,
      sugar: 0,
    },
    {
      name: 'Shrimp (1 oz)',
      calories: 24,
      protein: 5.2,
      carbs: 0,
      fat: 0.3,
      fiber: 0,
      sugar: 0,
    },
    {
      name: 'Tofu (1 oz)',
      calories: 22,
      protein: 2.4,
      carbs: 0.5,
      fat: 1.3,
      fiber: 0,
      sugar: 0,
    },
  ],

  proteinFlavors: [
    {
      name: 'Plain',
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      fiber: 0,
      sugar: 0,
    },
    {
      name: 'Teriyaki (2 tbsp)',
      calories: 30,
      protein: 0.5,
      carbs: 7,
      fat: 0,
      fiber: 0,
      sugar: 5,
    },
    {
      name: 'BBQ (2 tbsp)',
      calories: 35,
      protein: 0,
      carbs: 8,
      fat: 0,
      fiber: 0,
      sugar: 6,
    },
    {
      name: 'Lemon Herb (1 tbsp)',
      calories: 15,
      protein: 0,
      carbs: 1,
      fat: 1,
      fiber: 0,
      sugar: 0.5,
    },
    {
      name: 'Buffalo (2 tbsp)',
      calories: 20,
      protein: 0,
      carbs: 1,
      fat: 1.5,
      fiber: 0,
      sugar: 0,
    },
    {
      name: 'Garlic Parm (2 tbsp)',
      calories: 45,
      protein: 1,
      carbs: 2,
      fat: 3.5,
      fiber: 0,
      sugar: 0.5,
    },
  ],

  carbs: [
    {
      name: 'White Rice',
      calories: 200,
      protein: 4,
      carbs: 44,
      fat: 0.4,
      fiber: 0.6,
      sugar: 0,
    },
    {
      name: 'Brown Rice',
      calories: 215,
      protein: 5,
      carbs: 45,
      fat: 1.8,
      fiber: 3.5,
      sugar: 0,
    },
    {
      name: 'Sweet Potato',
      calories: 180,
      protein: 4,
      carbs: 41,
      fat: 0.1,
      fiber: 6.6,
      sugar: 13,
    },
    {
      name: 'Quinoa',
      calories: 222,
      protein: 8,
      carbs: 39,
      fat: 3.6,
      fiber: 5,
      sugar: 0,
    },
    {
      name: 'Pasta',
      calories: 220,
      protein: 8,
      carbs: 43,
      fat: 1.3,
      fiber: 2.5,
      sugar: 1,
    },
  ],

  veggies: [
    {
      name: 'Broccoli (1 cup)',
      calories: 55,
      protein: 3.7,
      carbs: 11,
      fat: 0.6,
      fiber: 5.1,
      sugar: 2.2,
    },
    {
      name: 'Mixed Vegetables (1 cup)',
      calories: 60,
      protein: 3,
      carbs: 12,
      fat: 0.5,
      fiber: 4,
      sugar: 4,
    },
    {
      name: 'Green Beans (1 cup)',
      calories: 44,
      protein: 2.4,
      carbs: 10,
      fat: 0.4,
      fiber: 4,
      sugar: 3.3,
    },
    {
      name: 'Asparagus (1 cup)',
      calories: 27,
      protein: 3,
      carbs: 5,
      fat: 0.2,
      fiber: 2.8,
      sugar: 2.5,
    },
    {
      name: 'Spinach (1 cup)',
      calories: 7,
      protein: 0.9,
      carbs: 1,
      fat: 0.1,
      fiber: 0.7,
      sugar: 0.1,
    },
  ],
}
