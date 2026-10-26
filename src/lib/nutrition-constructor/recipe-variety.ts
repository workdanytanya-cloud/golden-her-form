import type { PlanSlot } from "@/lib/nutrition-constructor/config";
import { OIL_PRODUCT_SLUGS } from "@/lib/nutrition-constructor/recipe-meta";
import type { ConstructorDay, Recipe } from "@/lib/nutrition-constructor/types";

export type MealRole = "breakfast" | "lunch" | "dinner" | "snack";

export type CookingMethod =
  | "boil"
  | "bake"
  | "stew"
  | "pan"
  | "assemble"
  | "soup"
  | "grill";

const PROTEIN_FAMILY: Record<string, string> = {
  "chicken-breast-raw": "chicken",
  "chicken-thigh-raw": "chicken",
  "turkey-breast-raw": "turkey",
  "ground-turkey-raw": "turkey",
  "beef-lean-raw": "beef",
  "pollock-raw": "whitefish",
  "cod-raw": "whitefish",
  "hake-raw": "whitefish",
  "pink-salmon-raw": "salmon",
  "canned-tuna": "tuna",
  "egg-whole": "egg",
  "egg-white-raw": "egg-white",
  "cottage-cheese-5": "cottage",
  "cottage-cheese-lf": "cottage",
  "greek-yogurt": "yogurt",
  "greek-yogurt-lf": "yogurt",
  kefir: "kefir",
  "kefir-lf": "kefir",
  "hard-cheese": "cheese",
  "lactose-free-milk": "milk",
};

const CARB_FAMILY: Record<string, string> = {
  "buckwheat-dry": "buckwheat",
  "rice-white-dry": "rice",
  "oats-dry": "oats",
  "bulgur-dry": "bulgur",
  "couscous-dry": "couscous",
  "pearl-barley-dry": "barley",
  "pasta-durum-dry": "pasta",
  "potato-raw": "potato",
  "lentils-dry": "lentils",
  "chickpeas-canned": "chickpeas",
  "white-beans-canned": "beans",
  lavash: "lavash",
  "wheat-bread": "bread",
  "rye-bread": "bread",
  crispbread: "crispbread",
};

export function proteinFamily(slug: string): string | null {
  return PROTEIN_FAMILY[slug] ?? null;
}

export function carbFamily(slug: string): string | null {
  return CARB_FAMILY[slug] ?? null;
}

export function inferPrimaryProtein(slugs: string[]): string {
  for (const slug of slugs) {
    const family = proteinFamily(slug);
    if (family) return family;
  }
  return "none";
}

export function inferPrimaryCarb(slugs: string[]): string {
  for (const slug of slugs) {
    const family = carbFamily(slug);
    if (family) return family;
  }
  return "veg";
}

export function inferCookingMethod(steps: string[], requiresCooking: boolean): CookingMethod {
  const text = steps.join(" ").toLowerCase();
  if (/суп|бульон/.test(text)) return "soup";
  if (/запеч|духовк|запекан/.test(text)) return "bake";
  if (/туш/.test(text)) return "stew";
  if (/обжар|сковород|омлет/.test(text)) return "pan";
  if (/отвар|свар|варк/.test(text)) return "boil";
  if (/гриль/.test(text)) return "grill";
  if (!requiresCooking) return "assemble";
  return "boil";
}

/** Signature from required (non-oil) ingredients + cooking method. */
export function buildIngredientSignature(
  requiredSlugs: string[],
  cookingMethod: CookingMethod | string,
): string {
  const core = [...new Set(requiredSlugs.filter((s) => !OIL_PRODUCT_SLUGS.has(s)))]
    .map((slug) => proteinFamily(slug) ?? carbFamily(slug) ?? slug)
    .sort();
  return `${cookingMethod}|${core.join("+")}`;
}

export function buildVariantGroup(
  primaryProtein: string,
  primaryCarb: string,
  cookingMethod: CookingMethod | string,
): string {
  return `${primaryProtein}|${primaryCarb}|${cookingMethod}`;
}

export function slotMealRole(slot: PlanSlot): MealRole {
  if (slot === "main1") return "breakfast";
  if (slot === "main2") return "lunch";
  if (slot === "main3") return "dinner";
  return "snack";
}

export function recipeSupportsRole(recipe: Recipe, role: MealRole): boolean {
  const roles = recipe.meal_types ?? [];
  if (roles.length === 0) {
    return role === "snack" ? recipe.meal_type === "snack" : recipe.meal_type === "main";
  }
  return roles.includes(role);
}

export function isEggBreakfastRecipe(recipe: Recipe, slugs: string[]): boolean {
  const roles = recipe.meal_types ?? [];
  const isBreakfast = roles.includes("breakfast") || (!roles.length && recipe.meal_type === "main");
  return isBreakfast && (slugs.includes("egg-whole") || inferPrimaryProtein(slugs) === "egg");
}

export type VarietyViolation = {
  code: "INSUFFICIENT_VARIETY";
  unique_days: number;
  limiting_meal_type: MealRole | "day" | "week";
  missing: string[];
  detail: string;
};

export type WeekVarietyStats = {
  uniqueDays: number;
  breakfasts: Set<string>;
  lunches: Set<string>;
  dinners: Set<string>;
  recipeIds: Set<string>;
  variantGroups: Set<string>;
  signatures: Set<string>;
  proteinCounts: Map<string, number>;
  eggBreakfasts: number;
};

export function collectWeekVarietyStats(
  days: ConstructorDay[],
  recipeById: Map<string, Recipe>,
): WeekVarietyStats {
  const stats: WeekVarietyStats = {
    uniqueDays: new Set(
      days.map((day) =>
        [...day.items]
          .sort((a, b) => a.slot.localeCompare(b.slot))
          .map((item) => `${item.slot}:${item.recipe_id}`)
          .join("|"),
      ),
    ).size,
    breakfasts: new Set(),
    lunches: new Set(),
    dinners: new Set(),
    recipeIds: new Set(),
    variantGroups: new Set(),
    signatures: new Set(),
    proteinCounts: new Map(),
    eggBreakfasts: 0,
  };

  for (const day of days) {
    for (const item of day.items) {
      stats.recipeIds.add(item.recipe_id);
      const recipe = recipeById.get(item.recipe_id);
      const role = slotMealRole(item.slot);
      if (role === "breakfast") stats.breakfasts.add(item.recipe_id);
      if (role === "lunch") stats.lunches.add(item.recipe_id);
      if (role === "dinner") stats.dinners.add(item.recipe_id);
      if (recipe?.variant_group) stats.variantGroups.add(recipe.variant_group);
      if (recipe?.ingredient_signature) stats.signatures.add(recipe.ingredient_signature);
      if (item.slot.startsWith("main") && recipe?.primary_protein) {
        stats.proteinCounts.set(
          recipe.primary_protein,
          (stats.proteinCounts.get(recipe.primary_protein) ?? 0) + 1,
        );
      }
      if (role === "breakfast" && recipe?.primary_protein === "egg") {
        stats.eggBreakfasts += 1;
      }
    }
  }
  return stats;
}

export function evaluateStrictWeekVariety(
  days: ConstructorDay[],
  recipeById: Map<string, Recipe>,
  options?: { allowRepeats?: boolean; requireSevenRoles?: boolean },
): VarietyViolation | null {
  if (options?.allowRepeats) return null;
  if (days.length === 0) {
    return {
      code: "INSUFFICIENT_VARIETY",
      unique_days: 0,
      limiting_meal_type: "week",
      missing: ["нет валидных дней"],
      detail: "Нет собранных дней",
    };
  }

  const seenRecipes = new Set<string>();
  const seenGroups = new Set<string>();
  const seenSignatures = new Set<string>();
  const dayFingerprints = new Set<string>();
  const proteinWeek = new Map<string, number>();
  let eggBreakfasts = 0;

  for (let i = 0; i < days.length; i++) {
    const day = days[i]!;
    const fp = [...day.items]
      .sort((a, b) => a.slot.localeCompare(b.slot))
      .map((item) => `${item.slot}:${item.recipe_id}`)
      .join("|");
    if (dayFingerprints.has(fp)) {
      return {
        code: "INSUFFICIENT_VARIETY",
        unique_days: dayFingerprints.size,
        limiting_meal_type: "day",
        missing: ["уникальные дни"],
        detail: "Повторяется одинаковый день",
      };
    }
    dayFingerprints.add(fp);

    const prev = days[i - 1];
    const mains = day.items.filter((item) => item.slot.startsWith("main"));
    for (let m = 0; m < mains.length; m++) {
      const item = mains[m]!;
      const recipe = recipeById.get(item.recipe_id);
      if (seenRecipes.has(item.recipe_id)) {
        return {
          code: "INSUFFICIENT_VARIETY",
          unique_days: dayFingerprints.size,
          limiting_meal_type: slotMealRole(item.slot),
          missing: [`уникальный recipe_id (${item.recipe_name})`],
          detail: "recipe_id повторяется чаще одного раза",
        };
      }
      seenRecipes.add(item.recipe_id);
      if (recipe?.variant_group) {
        if (seenGroups.has(recipe.variant_group)) {
          return {
            code: "INSUFFICIENT_VARIETY",
            unique_days: dayFingerprints.size,
            limiting_meal_type: slotMealRole(item.slot),
            missing: [`variant_group ${recipe.variant_group}`],
            detail: "variant_group повторяется чаще одного раза",
          };
        }
        seenGroups.add(recipe.variant_group);
      }
      if (recipe?.ingredient_signature) {
        if (seenSignatures.has(recipe.ingredient_signature)) {
          return {
            code: "INSUFFICIENT_VARIETY",
            unique_days: dayFingerprints.size,
            limiting_meal_type: slotMealRole(item.slot),
            missing: [`ingredient_signature ${recipe.ingredient_signature}`],
            detail: "ingredient_signature повторяется чаще одного раза",
          };
        }
        seenSignatures.add(recipe.ingredient_signature);
      }
      if (recipe?.primary_protein && recipe.primary_protein !== "none") {
        proteinWeek.set(
          recipe.primary_protein,
          (proteinWeek.get(recipe.primary_protein) ?? 0) + 1,
        );
      }
      if (slotMealRole(item.slot) === "breakfast" && recipe?.primary_protein === "egg") {
        eggBreakfasts += 1;
      }

      const neighborPrevSameSlot = prev?.items.find((x) => x.slot === item.slot);
      if (neighborPrevSameSlot) {
        const prevRecipe = recipeById.get(neighborPrevSameSlot.recipe_id);
        if (neighborPrevSameSlot.recipe_id === item.recipe_id) {
          return {
            code: "INSUFFICIENT_VARIETY",
            unique_days: dayFingerprints.size,
            limiting_meal_type: slotMealRole(item.slot),
            missing: ["соседние приёмы без повтора"],
            detail: "Одинаковые соседние приёмы",
          };
        }
        if (
          prevRecipe?.primary_protein &&
          recipe?.primary_protein &&
          prevRecipe.primary_protein === recipe.primary_protein &&
          recipe.primary_protein !== "none"
        ) {
          return {
            code: "INSUFFICIENT_VARIETY",
            unique_days: dayFingerprints.size,
            limiting_meal_type: slotMealRole(item.slot),
            missing: [`primary_protein ${recipe.primary_protein} в соседних приёмах`],
            detail: "Повтор primary_protein в соседних основных приёмах",
          };
        }
        if (
          prevRecipe?.primary_carb &&
          recipe?.primary_carb &&
          prevRecipe.primary_carb === recipe.primary_carb &&
          !["veg", "none"].includes(recipe.primary_carb)
        ) {
          return {
            code: "INSUFFICIENT_VARIETY",
            unique_days: dayFingerprints.size,
            limiting_meal_type: slotMealRole(item.slot),
            missing: [`крупа ${recipe.primary_carb} в соседних приёмах`],
            detail: "Повтор основной крупы в соседних приёмах",
          };
        }
      }

      if (m > 0) {
        const left = mains[m - 1]!;
        const leftRecipe = recipeById.get(left.recipe_id);
        if (
          leftRecipe?.primary_protein &&
          recipe?.primary_protein &&
          leftRecipe.primary_protein === recipe.primary_protein &&
          recipe.primary_protein !== "none"
        ) {
          return {
            code: "INSUFFICIENT_VARIETY",
            unique_days: dayFingerprints.size,
            limiting_meal_type: slotMealRole(item.slot),
            missing: [`primary_protein ${recipe.primary_protein} внутри дня`],
            detail: "Повтор primary_protein в соседних основных приёмах одного дня",
          };
        }
      }
    }
  }

  if (eggBreakfasts > 2) {
    return {
      code: "INSUFFICIENT_VARIETY",
      unique_days: dayFingerprints.size,
      limiting_meal_type: "breakfast",
      missing: ["яичные завтраки ≤ 2"],
      detail: `Яичных завтраков: ${eggBreakfasts}`,
    };
  }

  for (const [protein, count] of proteinWeek) {
    if (count > 3) {
      return {
        code: "INSUFFICIENT_VARIETY",
        unique_days: dayFingerprints.size,
        limiting_meal_type: "week",
        missing: [`primary_protein ${protein} ≤ 3`],
        detail: `${protein}: ${count} основных блюд`,
      };
    }
  }

  const stats = collectWeekVarietyStats(days, recipeById);
  const minRole = options?.requireSevenRoles ? 7 : 5;
  const missing: string[] = [];
  let limiting: MealRole | "day" | "week" = "week";
  if (stats.breakfasts.size < Math.min(minRole, days.length)) {
    missing.push(`завтраков ≥ ${Math.min(minRole, days.length)} (сейчас ${stats.breakfasts.size})`);
    limiting = "breakfast";
  }
  if (stats.lunches.size < Math.min(minRole, days.length)) {
    missing.push(`обедов ≥ ${Math.min(minRole, days.length)} (сейчас ${stats.lunches.size})`);
    if (limiting === "week") limiting = "lunch";
  }
  if (stats.dinners.size < Math.min(minRole, days.length)) {
    missing.push(`ужинов ≥ ${Math.min(minRole, days.length)} (сейчас ${stats.dinners.size})`);
    if (limiting === "week") limiting = "dinner";
  }
  if (missing.length > 0) {
    return {
      code: "INSUFFICIENT_VARIETY",
      unique_days: stats.uniqueDays,
      limiting_meal_type: limiting,
      missing,
      detail: missing.join("; "),
    };
  }

  return null;
}

export function formatInsufficientVarietyMessage(violation: VarietyViolation): string {
  return [
    "INSUFFICIENT_VARIETY",
    `уникальных дней: ${violation.unique_days}`,
    `ограничение: ${violation.limiting_meal_type}`,
    `не хватает: ${violation.missing.join(", ")}`,
  ].join(" — ");
}
