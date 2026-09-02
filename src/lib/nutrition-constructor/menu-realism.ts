import { OIL_GRAM_MAX, OIL_DAILY_MAX_G } from "@/lib/nutrition-constructor/config";
import { d } from "@/lib/nutrition-constructor/decimal-math";
import {
  NUT_SEED_PRODUCT_SLUGS,
  PROTEIN_MAIN_PRODUCT_SLUGS,
} from "@/lib/nutrition-constructor/recipe-meta";
import type { ConstructorDay, FoodProduct, MealPlanItem } from "@/lib/nutrition-constructor/types";

export type MenuRealismIssue = {
  code: string;
  message: string;
  slot?: string;
};

function slugOf(products: Map<string, FoodProduct>, productId: string): string | null {
  return products.get(productId)?.slug ?? productId;
}

export function validateMenuRealism(params: {
  day: ConstructorDay;
  products: Map<string, FoodProduct>;
  forbiddenProductIds?: Set<string>;
  dayProteinTargetG?: number;
}): MenuRealismIssue[] {
  const { day, products, forbiddenProductIds, dayProteinTargetG } = params;
  const issues: MenuRealismIssue[] = [];
  let dayOilG = 0;

  for (const item of day.items) {
    if (item.slot.startsWith("snack")) {
      if (item.requires_cooking) {
        issues.push({
          code: "snack_requires_cooking",
          message: "Перекус требует приготовления",
          slot: item.slot,
        });
      }
      const treatOnly =
        item.ingredients.length <= 1 &&
        item.ingredients.every((ing) => {
          const slug = slugOf(products, ing.product_id);
          return slug === "marshmallow" || slug === "stevia-candy" || slug === "dried-mango";
        });
      if (treatOnly) {
        issues.push({
          code: "snack_treat_only",
          message: "Перекус состоит только из сладости",
          slot: item.slot,
        });
      }
    }

    for (const ing of item.ingredients) {
      const grams = d(ing.grams).toNumber();
      const slug = slugOf(products, ing.product_id);
      if (!slug) continue;

      if (forbiddenProductIds?.has(ing.product_id)) {
        issues.push({
          code: "allergen_in_meal",
          message: `Запрещённый продукт в приёме: ${ing.product_name}`,
          slot: item.slot,
        });
      }

      if (slug.includes("-dry") && (grams < 20 || grams > 120)) {
        issues.push({
          code: "grain_portion",
          message: `Нереалистичная порция крупы (${grams} г): ${ing.product_name}`,
          slot: item.slot,
        });
      }
      if (PROTEIN_MAIN_PRODUCT_SLUGS.has(slug) && !slug.includes("cheese") && (grams < 60 || grams > 350)) {
        issues.push({
          code: "protein_portion",
          message: `Нереалистичная порция белка (${grams} г): ${ing.product_name}`,
          slot: item.slot,
        });
      }
      if (NUT_SEED_PRODUCT_SLUGS.has(slug) && grams > 35) {
        issues.push({
          code: "nut_portion",
          message: `Слишком много орехов/семечек (${grams} г)`,
          slot: item.slot,
        });
      }
      if ((slug === "olive-oil" || slug === "sunflower-oil" || slug === "butter") && grams > OIL_GRAM_MAX) {
        issues.push({
          code: "oil_portion",
          message: `Слишком много масла в приёме (${grams} г)`,
          slot: item.slot,
        });
        dayOilG += grams;
      } else if (slug === "olive-oil" || slug === "sunflower-oil" || slug === "butter") {
        dayOilG += grams;
      }
    }

    if (item.slot.startsWith("main") && dayProteinTargetG != null) {
      const mainProtein = d(item.protein_g).toNumber();
      if (mainProtein > dayProteinTargetG * 0.65) {
        issues.push({
          code: "protein_concentrated",
          message: `Один основной приём содержит ${Math.round(mainProtein)} г белка (>65% дня)`,
          slot: item.slot,
        });
      }
    }
  }

  if (dayOilG > OIL_DAILY_MAX_G) {
    issues.push({
      code: "oil_daily",
      message: `Суммарно масла за день ${dayOilG} г (лимит ${OIL_DAILY_MAX_G} г)`,
    });
  }

  return issues;
}

export function formatDayMenuReport(day: ConstructorDay): string {
  const lines: string[] = [];
  for (const item of day.items) {
    lines.push(
      `\n${item.slot}: ${item.recipe_name} · ${item.kcal} ккал · Б${item.protein_g} Ж${item.fat_g} У${item.carbs_g} · ${item.prep_time_min ?? "—"} мин`,
    );
    for (const ing of item.ingredients) {
      if (d(ing.grams).toNumber() <= 0) continue;
      lines.push(`  - ${ing.product_name}: ${ing.grams} г`);
    }
  }
  lines.push(
    `\nИтог дня: ${day.kcal} ккал · Б${day.protein_g} Ж${day.fat_g} У${day.carbs_g}`,
  );
  return lines.join("\n");
}
