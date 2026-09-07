import type { DietaryRestriction } from '../domain/types';

/**
 * A small curated set of everyday foods with rounded reference nutrition
 * (per the stated common portion). Values are typical label / USDA-style
 * figures — used only to ILLUSTRATE what a macro target looks like, never as a
 * prescribed meal plan (PRODUCT_VISION: no false precision).
 */

export type MacroRole = 'protein' | 'carb' | 'fat' | 'fibre';

export interface FoodItem {
  name: string;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  fibre_g?: number;
  roles: MacroRole[];
  /** Restrictions this item VIOLATES (so it can be filtered out). */
  excluded_by: DietaryRestriction[];
}

const DAIRY: DietaryRestriction[] = ['dairy_free', 'lactose_intolerant', 'vegan'];
const ANIMAL_FLESH: DietaryRestriction[] = ['vegetarian', 'vegan', 'pescatarian'];
const FISH: DietaryRestriction[] = ['vegetarian', 'vegan'];
const GLUTEN: DietaryRestriction[] = ['gluten_free'];

export const FOODS: FoodItem[] = [
  // --- protein-forward ---
  { name: '1 cup Greek yoghurt (200 g)', protein_g: 17, carb_g: 8, fat_g: 4, roles: ['protein'], excluded_by: DAIRY },
  { name: '1 cup low-fat cottage cheese (200 g)', protein_g: 22, carb_g: 6, fat_g: 4, roles: ['protein'], excluded_by: DAIRY },
  { name: '3 large eggs', protein_g: 18, carb_g: 1, fat_g: 15, roles: ['protein', 'fat'], excluded_by: ['vegan', 'egg_free'] },
  { name: '150 g chicken breast, cooked', protein_g: 46, carb_g: 0, fat_g: 5, roles: ['protein'], excluded_by: ANIMAL_FLESH },
  { name: '150 g lean beef, cooked', protein_g: 40, carb_g: 0, fat_g: 12, roles: ['protein'], excluded_by: [...ANIMAL_FLESH, 'no_beef'] },
  { name: '120 g salmon, cooked', protein_g: 26, carb_g: 0, fat_g: 13, roles: ['protein', 'fat'], excluded_by: FISH },
  { name: '1 can tuna in spring water (120 g drained)', protein_g: 28, carb_g: 0, fat_g: 1, roles: ['protein'], excluded_by: FISH },
  { name: '150 g firm tofu', protein_g: 17, carb_g: 4, fat_g: 9, roles: ['protein'], excluded_by: ['soy_free'] },
  { name: '100 g tempeh', protein_g: 19, carb_g: 8, fat_g: 11, roles: ['protein'], excluded_by: ['soy_free'] },
  { name: '1 scoop whey protein (30 g)', protein_g: 24, carb_g: 2, fat_g: 1, roles: ['protein'], excluded_by: DAIRY },
  { name: '250 ml milk', protein_g: 8, carb_g: 12, fat_g: 8, roles: ['protein'], excluded_by: DAIRY },
  { name: '40 g cheddar cheese', protein_g: 10, carb_g: 0, fat_g: 14, roles: ['protein', 'fat'], excluded_by: DAIRY },
  { name: '1 cup cooked lentils (200 g)', protein_g: 18, carb_g: 40, fat_g: 1, fibre_g: 16, roles: ['protein', 'carb', 'fibre'], excluded_by: [] },
  { name: '1 cup edamame (150 g)', protein_g: 17, carb_g: 14, fat_g: 8, fibre_g: 8, roles: ['protein', 'fibre'], excluded_by: ['soy_free'] },

  // --- carbohydrate-forward ---
  { name: '1 medium banana', protein_g: 1, carb_g: 27, fat_g: 0, fibre_g: 3, roles: ['carb'], excluded_by: [] },
  { name: '2 slices wholemeal bread', protein_g: 8, carb_g: 30, fat_g: 2, fibre_g: 5, roles: ['carb', 'fibre'], excluded_by: GLUTEN },
  { name: '1 cup cooked rice (180 g)', protein_g: 4, carb_g: 45, fat_g: 0, roles: ['carb'], excluded_by: [] },
  { name: '1 cup cooked pasta (180 g)', protein_g: 8, carb_g: 43, fat_g: 1, fibre_g: 3, roles: ['carb'], excluded_by: GLUTEN },
  { name: '1 large potato, baked (250 g)', protein_g: 5, carb_g: 37, fat_g: 0, fibre_g: 4, roles: ['carb', 'fibre'], excluded_by: [] },
  { name: '1 cup cooked oats (240 g)', protein_g: 6, carb_g: 27, fat_g: 3, fibre_g: 4, roles: ['carb', 'fibre'], excluded_by: [] },
  { name: '1 large sweet potato (250 g)', protein_g: 4, carb_g: 37, fat_g: 0, fibre_g: 6, roles: ['carb', 'fibre'], excluded_by: [] },
  { name: '1 cup cooked quinoa (185 g)', protein_g: 8, carb_g: 39, fat_g: 4, fibre_g: 5, roles: ['carb', 'fibre'], excluded_by: [] },
  { name: '1 apple + 1 orange', protein_g: 1, carb_g: 40, fat_g: 0, fibre_g: 8, roles: ['carb', 'fibre'], excluded_by: [] },
  { name: '40 g raisins', protein_g: 1, carb_g: 32, fat_g: 0, roles: ['carb'], excluded_by: [] },

  // --- fat-forward ---
  { name: '1/2 avocado', protein_g: 2, carb_g: 6, fat_g: 15, fibre_g: 5, roles: ['fat', 'fibre'], excluded_by: [] },
  { name: '30 g almonds', protein_g: 6, carb_g: 6, fat_g: 15, fibre_g: 3, roles: ['fat', 'protein'], excluded_by: ['nut_allergy'] },
  { name: '30 g peanuts', protein_g: 7, carb_g: 5, fat_g: 14, fibre_g: 2, roles: ['fat', 'protein'], excluded_by: ['nut_allergy'] },
  { name: '1 tbsp peanut butter', protein_g: 4, carb_g: 3, fat_g: 8, roles: ['fat'], excluded_by: ['nut_allergy'] },
  { name: '1 tbsp olive oil', protein_g: 0, carb_g: 0, fat_g: 14, roles: ['fat'], excluded_by: [] },
  { name: '20 g pumpkin seeds', protein_g: 6, carb_g: 3, fat_g: 10, fibre_g: 1, roles: ['fat', 'protein'], excluded_by: [] },

  // --- fibre / veg ---
  { name: '2 cups mixed vegetables', protein_g: 4, carb_g: 16, fat_g: 1, fibre_g: 7, roles: ['fibre', 'carb'], excluded_by: [] },
  { name: '1 cup black beans (170 g)', protein_g: 15, carb_g: 41, fat_g: 1, fibre_g: 15, roles: ['fibre', 'protein', 'carb'], excluded_by: [] },
  { name: '1 pear + 30 g chia in yoghurt', protein_g: 6, carb_g: 28, fat_g: 6, fibre_g: 13, roles: ['fibre'], excluded_by: DAIRY },
];

export function foodsFor(role: MacroRole, restrictions: readonly DietaryRestriction[]): FoodItem[] {
  return FOODS.filter(
    (f) => f.roles.includes(role) && !f.excluded_by.some((r) => restrictions.includes(r)),
  );
}
