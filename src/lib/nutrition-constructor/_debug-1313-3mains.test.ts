import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { DEFAULT_TOLERANCE, slotCalorieShare, slotsForMode } from "@/lib/nutrition-constructor/config";
import { d } from "@/lib/nutrition-constructor/decimal-math";
import { generateConstructorPlan, type OptimizerContext } from "@/lib/nutrition-constructor/optimizer";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import { macroPriorities, verifiedIngredients } from "@/lib/nutrition-constructor/recipe-selection";
import { solveDayMacros } from "@/lib/nutrition-constructor/macro-solver";
import { enrichMainIngredientsWithOil, tuneDayToTargets } from "@/lib/nutrition-constructor/day-balance";
import { buildIngredientLine, buildMealPlanItem } from "@/lib/nutrition-constructor/calculator";

describe("debug 1313 three_mains_only", () => {
  it("dumps plan", { timeout: 90_000 }, () => {
    const targets = {
      kcal: d(1313),
      protein_g: d(112.1),
      fat_g: d(56.1),
      carbs_g: d(89.9),
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
    lines.push(`best score ${gen.diagnostics?.best_deviation_score}`);
    const liveDay = gen.days[0];
    if (liveDay) {
      lines.push(`\nLIVE DAY kcal=${liveDay.kcal} P=${liveDay.protein_g} F=${liveDay.fat_g} C=${liveDay.carbs_g} valid=${liveDay.is_valid}`);
      for (const item of liveDay.items) {
        lines.push(`\n== ${item.slot} ${item.recipe_name} slug=${ctx.recipes.find((r) => r.id === item.recipe_id)?.slug}`);
        lines.push(`   meal ${item.kcal} / P${item.protein_g} F${item.fat_g} C${item.carbs_g}`);
        const recipeIngs = ctx.recipeIngredients.get(item.recipe_id) ?? [];
        for (const ing of item.ingredients) {
          const ri = recipeIngs.find((x) => x.product_id === ing.product_id);
          const product = ctx.products.get(ing.product_id);
          const g = Number(ing.grams);
          const minG = ri?.min_g ?? (product?.slug && ["olive-oil", "sunflower-oil"].includes(product.slug) ? 0 : "?");
          const maxG = ri?.max_g ?? (product?.slug && ["olive-oil", "sunflower-oil"].includes(product.slug) ? 15 : "?");
          const atMin = typeof minG === "number" && g <= minG;
          const atMax = typeof maxG === "number" && g >= maxG;
          const bound = atMin ? " MIN" : atMax ? " MAX" : "";
          lines.push(
            `   - ${ing.product_name} (${product?.slug}) ${g}g [${minG}-${maxG}]${bound}  P${ing.protein_g} F${ing.fat_g} C${ing.carbs_g}`,
          );
        }
      }
    }

    const slugs = gen.diagnostics?.best_recipe_slugs ?? [];
    const shares = slotCalorieShare(mode);
    const slots = slotsForMode(mode);
    const priorities = macroPriorities(targets);
    lines.push(`priorities ${JSON.stringify(priorities)}`);
    const excluded = new Set<string>();
    const dayCtx = {
      products: ctx.products,
      recipeIngredients: ctx.recipeIngredients,
      recipes: ctx.recipes,
    };

    const slotRecipes = slugs
      .map((s) => ctx.recipes.find((r) => r.slug === s))
      .filter(Boolean);
    if (slotRecipes.length === slots.length) {
      const items = slots.map((slot, i) => {
        const recipe = slotRecipes[i]!;
        let ings = verifiedIngredients(ctx, recipe, excluded);
        if (
          slot.startsWith("main") &&
          (priorities.lowCarb || (priorities.proteinFocused && !priorities.strictHighProtein))
        ) {
          ings = enrichMainIngredientsWithOil(dayCtx, recipe, ings, excluded);
        }
        const linesIng = ings.map((ri, idx) => {
          const p = ctx.products.get(ri.product_id)!;
          const g = ri.default_g ?? Math.round((ri.min_g + ri.max_g) / 2);
          return buildIngredientLine(p, g, idx);
        });
        return buildMealPlanItem({ slot, recipe, ingredients: linesIng });
      });
      const tuned = tuneDayToTargets({
        ctx: dayCtx,
        items,
        targets,
        tolerance: DEFAULT_TOLERANCE,
        maxSteps: 2000,
        priorities,
      });
      const solved = solveDayMacros({
        ctx: dayCtx,
        items: tuned.items,
        targets,
        tolerance: DEFAULT_TOLERANCE,
        maxIterations: 2500,
        enableFinishing: true,
      });
      const snap = {
        kcal: Number(solved.totals.kcal),
        P: Number(solved.totals.protein_g),
        F: Number(solved.totals.fat_g),
        C: Number(solved.totals.carbs_g),
      };
      lines.push(`\nRECONSTRUCTED valid=${solved.valid} kcal=${snap.kcal} P=${snap.P} F=${snap.F} C=${snap.C}`);
      lines.push(
        `delta kcal=${(snap.kcal - 1313).toFixed(1)} P=${(snap.P - 112.1).toFixed(1)} F=${(snap.F - 56.1).toFixed(1)} C=${(snap.C - 89.9).toFixed(1)}`,
      );
      for (const item of solved.items) {
        lines.push(`\n== ${item.slot} ${item.recipe_name} slug=${ctx.recipes.find((r) => r.id === item.recipe_id)?.slug}`);
        lines.push(`   meal ${item.kcal} / P${item.protein_g} F${item.fat_g} C${item.carbs_g}`);
        const recipeIngs = ctx.recipeIngredients.get(item.recipe_id) ?? [];
        for (const ing of item.ingredients) {
          const ri = recipeIngs.find((x) => x.product_id === ing.product_id);
          const product = ctx.products.get(ing.product_id);
          const g = Number(ing.grams);
          const minG = ri?.min_g ?? (product?.slug?.includes("oil") ? 0 : "?");
          const maxG = ri?.max_g ?? (product?.slug?.includes("oil") ? 15 : "?");
          const atMin = typeof minG === "number" && g <= minG;
          const atMax = typeof maxG === "number" && g >= maxG;
          const bound = atMin ? " MIN" : atMax ? " MAX" : "";
          lines.push(
            `   - ${ing.product_name} (${product?.slug}) ${g}g [${minG}-${maxG}]${bound}  P${ing.protein_g} F${ing.fat_g} C${ing.carbs_g}`,
          );
        }
      }
    }

    writeFileSync("_debug-1313-3mains.txt", lines.join("\n"), "utf8");
  });
});
