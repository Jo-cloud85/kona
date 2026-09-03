/**
 * Known-product catalog.
 *
 * PRODUCT_VISION.md "Precision philosophy": use exact values only where they are
 * genuinely known from a label. Where a value is not on file it is `null` and the
 * system must NOT invent one (CLAUDE.md rule 6, CALCULATION_ENGINE_SPEC.md §14).
 */

export type ProductKind = 'gel' | 'drink_mix' | 'bottle' | 'shake' | 'bar';

export interface CatalogNutrition {
  /** Per single unit / serving. `null` = not on file — do not invent. */
  carbohydrate_g: number | null;
  sodium_mg: number | null;
  protein_g: number | null;
  fluid_ml: number | null;
}

export interface CatalogProduct {
  id: string;
  name: string;
  aliases: string[];
  kind: ProductKind;
  nutrition: CatalogNutrition;
  nutrition_source: 'label' | 'unknown';
  note?: string;
}

const NONE: CatalogNutrition = {
  carbohydrate_g: null,
  sodium_mg: null,
  protein_g: null,
  fluid_ml: null,
};

export const CATALOG: CatalogProduct[] = [
  {
    id: 'sis-go-isotonic-gel',
    name: 'SIS GO Isotonic Energy Gel',
    aliases: ['sis gel', 'sis', 'science in sport gel', 'go gel', 'sis go gel'],
    kind: 'gel',
    nutrition: { ...NONE },
    nutrition_source: 'unknown',
    note: 'Carbohydrate/sodium not on file. Add verified label values before using this product in calculations.',
  },
  {
    id: 'bottle-750',
    name: '750 ml bottle',
    aliases: ['750ml bottle', '750 ml bottle', 'my bottle', 'bottle', 'water bottle'],
    kind: 'bottle',
    // The container volume is known; contents default to water unless stated.
    nutrition: { ...NONE, fluid_ml: 750 },
    nutrition_source: 'label',
  },
  {
    id: 'protein-shake-24g',
    name: '24 g protein shake',
    aliases: ['protein shake', 'shake', '24g shake', '24 g shake'],
    kind: 'shake',
    nutrition: { ...NONE, protein_g: 24 },
    nutrition_source: 'label',
  },
];

const BY_ID = new Map(CATALOG.map((p) => [p.id, p]));

export function getProduct(id: string): CatalogProduct | undefined {
  return BY_ID.get(id);
}

/**
 * Resolve a free-text phrase to a catalog product. Deliberately conservative:
 * matches on a known alias appearing as a substring. Returns undefined when
 * nothing matches (the caller then records the raw description as user-reported).
 */
export function resolveProductByPhrase(text: string): CatalogProduct | undefined {
  const t = text.toLowerCase();
  // Prefer the longest alias match so "750ml bottle" beats "bottle".
  let best: { product: CatalogProduct; len: number } | undefined;
  for (const product of CATALOG) {
    for (const alias of product.aliases) {
      if (t.includes(alias) && (!best || alias.length > best.len)) {
        best = { product, len: alias.length };
      }
    }
  }
  return best?.product;
}
