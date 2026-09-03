import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { DEFAULT_TOLERANCE } from "@/lib/nutrition-constructor/config";
import { d } from "@/lib/nutrition-constructor/decimal-math";
import { generateConstructorPlan, type OptimizerContext } from "@/lib/nutrition-constructor/optimizer";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import { macroPriorities } from "@/lib/nutrition-constructor/recipe-selection";

describe("debug 1313 three_main_two_snacks", () => {
  it("dumps plan", { timeout: 90_000 }, () => {
    const targets = {
      kcal: d(1313),
      protein_g: d(112.1),
      fat_g: d(56.1),
      carbs_g: d(89.9),
      fiber_g: d(0),
    };
    const mode = "three_main_two_snacks" as const;
    const ctx = buildInMemoryCatalog({ includeTestPackaging: true }) as OptimizerContext;
    const gen = generateConstructorPlan(ctx, {
      targets,
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: mode,
      primary_meal_slot: "lunch",
    });
    const priorities = macroPriorities(targets);
    const lines: string[] = [];
    lines.push(`valid ${gen.is_valid}`);
    lines.push(`message ${gen.message ?? ""}`);
    lines.push(`reason ${gen.diagnostics?.last_failure_reason}`);
    lines.push(`checked ${gen.diagnostics?.combinations_checked}`);
    lines.push(`elapsed ${gen.diagnostics?.elapsed_ms}`);
    lines.push(`timed_out ${gen.diagnostics?.timed_out}`);
    lines.push(`best slugs ${gen.diagnostics?.best_recipe_slugs?.join(" | ")}`);
    lines.push(`priorities ${JSON.stringify(priorities)}`);
    lines.push("\nSNACKS available for mode:");
    for (const r of ctx.snackRecipes.filter(
      (x) => x.is_active && x.allowed_schedule_modes.includes(mode),
    )) {
      lines.push(`  - ${r.slug} cook=${r.requires_cooking} protein=${r.contains_protein_source}`);
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
          const atMin = typeof minG === "number" && g <= minG;
          const atMax = typeof maxG === "number" && g >= maxG;
          const bound = atMin ? " MIN" : atMax ? " MAX" : "";
          lines.push(
            `   - ${ing.product_name} (${product?.slug}) ${g}g [${minG}-${maxG}]${bound}  P${ing.protein_g} F${ing.fat_g} C${ing.carbs_g}`,
          );
        }
      }
    } else {
      lines.push("NO DAY");
    }
    writeFileSync("_debug-1313-3plus2.txt", lines.join("\n"), "utf8");
  });
});
