import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { DEFAULT_TOLERANCE } from "@/lib/nutrition-constructor/config";
import { d } from "@/lib/nutrition-constructor/decimal-math";
import { generateConstructorPlan, type OptimizerContext } from "@/lib/nutrition-constructor/optimizer";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import { isLeanCarbMainRecipe, macroPriorities } from "@/lib/nutrition-constructor/recipe-selection";

describe("debug 1800 three_mains_only", () => {
  it("dumps plan", { timeout: 90_000 }, () => {
    const targets = {
      kcal: d(1800),
      protein_g: d(135),
      fat_g: d(60),
      carbs_g: d(180),
      fiber_g: d(0),
    };
    const mode = "three_mains_only" as const;
    const ctx = buildInMemoryCatalog({ includeTestPackaging: true }) as OptimizerContext;
    const gen = generateConstructorPlan(ctx, {
      targets,
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: mode,
      primary_meal_slot: "lunch",
    });
    const lines: string[] = [];
    lines.push(`valid ${gen.is_valid}`);
    lines.push(`message ${gen.message ?? ""}`);
    lines.push(`reason ${gen.diagnostics?.last_failure_reason}`);
    lines.push(`checked ${gen.diagnostics?.combinations_checked}`);
    lines.push(`elapsed ${gen.diagnostics?.elapsed_ms}`);
    lines.push(`timed_out ${gen.diagnostics?.timed_out}`);
    lines.push(`best slugs ${gen.diagnostics?.best_recipe_slugs?.join(" | ")}`);
    lines.push(`priorities ${JSON.stringify(macroPriorities(targets))}`);
    lines.push("\nMAINS in catalog:");
    for (const r of ctx.mainRecipes.filter((x) => x.is_active)) {
      const grain = /rice|buckwheat|oats/.test(r.slug);
      const fat = /beef|omelette|cheese|avocado/.test(r.slug);
      const lean = isLeanCarbMainRecipe(ctx, r);
      lines.push(`  - ${r.slug} grain=${grain} fatFwd=${fat} leanCarb=${lean}`);
    }
    const day = gen.days[0] ?? gen.best_approximation?.days[0];
    if (day) {
      lines.push(
        `\nDAY kcal=${day.kcal} P=${day.protein_g} F=${day.fat_g} C=${day.carbs_g} valid=${day.is_valid}`,
      );
      for (const item of day.items) {
        const recipe = ctx.recipes.find((r) => r.id === item.recipe_id);
        lines.push(`\n== ${item.slot} ${item.recipe_name} slug=${recipe?.slug}`);
        lines.push(`   meal ${item.kcal} / P${item.protein_g} F${item.fat_g} C${item.carbs_g}`);
        const recipeIngs = ctx.recipeIngredients.get(item.recipe_id) ?? [];
        for (const ing of item.ingredients) {
          const ri = recipeIngs.find((x) => x.product_id === ing.product_id);
          const product = ctx.products.get(ing.product_id);
          const g = Number(ing.grams);
          const minG = ri?.min_g ?? "?";
          const maxG = ri?.max_g ?? "?";
          const bound = typeof minG === "number" && g <= minG ? " MIN" : typeof maxG === "number" && g >= maxG ? " MAX" : "";
          lines.push(
            `   - ${ing.product_name} (${product?.slug}) ${g}g [${minG}-${maxG}]${bound}  P${ing.protein_g} F${ing.fat_g} C${ing.carbs_g}`,
          );
        }
      }
    } else {
      lines.push("NO DAY");
    }
    writeFileSync("_debug-1800-3mains.txt", lines.join("\n"), "utf8");
  });
});
