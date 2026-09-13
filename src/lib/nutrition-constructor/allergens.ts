import type { FoodProduct } from "@/lib/nutrition-constructor/types";

/** Стандартные теги аллергенов (EU / Codex). */
export const STANDARD_ALLERGEN_TAGS = [
  "gluten",
  "dairy",
  "lactose",
  "egg",
  "fish",
  "shellfish",
  "nuts",
  "peanut",
  "soy",
  "sesame",
  "celery",
  "mustard",
  "sulfites",
  "lupin",
  "molluscs",
] as const;

export type StandardAllergenTag = (typeof STANDARD_ALLERGEN_TAGS)[number];

/** Маппинг slug продукта → теги аллергенов. */
export const PRODUCT_ALLERGEN_TAGS: Record<string, string[]> = {
  "egg-whole": ["egg"],
  "hard-cheese": ["dairy", "lactose"],
  "lactose-free-milk": ["dairy"],
  "canned-tuna": ["fish"],
  "pollock-raw": ["fish"],
  walnut: ["nuts"],
  almond: ["nuts"],
  "pumpkin-seeds": ["sesame"],
  "oats-dry": ["gluten"],
  "buckwheat-dry": [],
  "rice-white-dry": [],
  "crispbread": ["gluten"],
  lavash: ["gluten"],
  butter: ["dairy", "lactose", "milk"],
};

/** Группы продуктов для исключений из анкеты. */
export const PRODUCT_GROUP_TAGS: Record<string, string> = {
  "chicken-breast-raw": "poultry",
  "beef-lean-raw": "red_meat",
  "pollock-raw": "fish",
  "canned-tuna": "fish",
  "egg-whole": "egg",
  "hard-cheese": "dairy",
  "lactose-free-milk": "dairy",
  butter: "dairy",
  "oats-dry": "grain",
  "buckwheat-dry": "grain",
  "rice-white-dry": "grain",
  walnut: "nuts",
  almond: "nuts",
  "pumpkin-seeds": "seeds",
};

const ALLERGEN_TEXT_PATTERNS: Array<{ pattern: RegExp; tags: string[] }> = [
  { pattern: /глютен|пшениц|рж|ячмен|овсян/i, tags: ["gluten"] },
  { pattern: /лактоз|молок|молоч|сыр|творог|кефир|сливк/i, tags: ["dairy", "lactose"] },
  { pattern: /молочн\s*бел|казеин|сыворот/i, tags: ["dairy", "milk"] },
  { pattern: /яйц/i, tags: ["egg"] },
  { pattern: /рыб|минтай|тунец|лосос|форел/i, tags: ["fish"] },
  { pattern: /орех|миндал|грецк|фундук|кешью|фисташ/i, tags: ["nuts"] },
  { pattern: /арахис/i, tags: ["peanut", "nuts"] },
  { pattern: /соя|тофу/i, tags: ["soy"] },
  { pattern: /кунжут|сesame/i, tags: ["sesame"] },
  { pattern: /мед/i, tags: ["honey"] },
  { pattern: /куриц|индейк|птиц/i, tags: ["poultry"] },
  { pattern: /говядин|свинин|баранин|мяс/i, tags: ["red_meat"] },
];

export type ClientNutritionRestrictions = {
  allergies?: string | null;
  intolerances?: string | null;
  disliked_foods?: string | null;
  excluded_products?: string | null;
  excluded_product_slugs?: string[];
  excluded_product_ids?: string[];
};

export function parseRestrictionTags(text: string | null | undefined): Set<string> {
  const tags = new Set<string>();
  if (!text?.trim()) return tags;
  for (const { pattern, tags: t } of ALLERGEN_TEXT_PATTERNS) {
    if (pattern.test(text)) t.forEach((x) => tags.add(x));
  }
  return tags;
}

export function buildForbiddenProductIds(
  products: FoodProduct[],
  restrictions: ClientNutritionRestrictions,
): { forbiddenIds: Set<string>; reasons: Map<string, string> } {
  const forbiddenIds = new Set<string>(restrictions.excluded_product_ids ?? []);
  const reasons = new Map<string, string>();

  for (const slug of restrictions.excluded_product_slugs ?? []) {
    const p = products.find((x) => x.slug === slug);
    if (p) {
      forbiddenIds.add(p.id);
      reasons.set(p.id, "Исключено клиентом");
    }
  }

  const tagSources = [
    parseRestrictionTags(restrictions.allergies),
    parseRestrictionTags(restrictions.intolerances),
    parseRestrictionTags(restrictions.disliked_foods),
    parseRestrictionTags(restrictions.excluded_products),
  ];

  const forbiddenTags = new Set<string>();
  for (const src of tagSources) src.forEach((t) => forbiddenTags.add(t));

  for (const product of products) {
    if (forbiddenIds.has(product.id)) continue;
    const slugTags = PRODUCT_ALLERGEN_TAGS[product.slug] ?? [];
    const customTags = (product as FoodProduct & { allergen_tags?: string[] }).allergen_tags ?? [];
    const allTags = [...slugTags, ...customTags];
    const group = PRODUCT_GROUP_TAGS[product.slug];
    const hit = allTags.find((t) => forbiddenTags.has(t)) ?? (group && forbiddenTags.has(group) ? group : null);
    if (hit) {
      forbiddenIds.add(product.id);
      reasons.set(product.id, `Аллерген/исключение: ${hit}`);
    }
    if (restrictions.disliked_foods && product.name && restrictions.disliked_foods.toLowerCase().includes(product.name.toLowerCase())) {
      forbiddenIds.add(product.id);
      reasons.set(product.id, "Нелюбимый продукт");
    }
  }

  return { forbiddenIds, reasons };
}

export function recipeContainsForbiddenIngredient(
  ingredientProductIds: string[],
  forbiddenIds: Set<string>,
): boolean {
  return ingredientProductIds.some((id) => forbiddenIds.has(id));
}
