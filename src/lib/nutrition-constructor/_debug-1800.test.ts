import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { DEFAULT_TOLERANCE, slotCalorieShare } from "@/lib/nutrition-constructor/config";
import { d, displayMacro, withinTolerance } from "@/lib/nutrition-constructor/decimal-math";
import { generateConstructorPlan, type OptimizerContext } from "@/lib/nutrition-constructor/optimizer";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import { macroPriorities } from "@/lib/nutrition-constructor/recipe-selection";
import { solveDayMacros } from "@/lib/nutrition-constructor/macro-solver";
import { tuneDayToTargets } from "@/lib/nutrition-constructor/day-balance";
import {
  buildIngredientLine,
  buildMealPlanItem,
} from "@/lib/nutrition-constructor/calculator";
import { enrichMainIngredientsWithOil } from "@/lib/nutrition-constructor/day-balance";
import { verifiedIngredients, slotMacroTargets } from "@/lib/nutrition-constructor/recipe-selection";

describe("debug 1800", () => {
  it("dumps plan", { timeout: 45_000 }, () => {
    const targets = {
      kcal: d(1800),
      protein_g: d(135),
      fat_g: d(60),
      carbs_g: d(180),
      fiber_g: d(0),
    };
    const ctx = buildInMemoryCatalog({ includeTestPackaging: true }) as OptimizerContext;
    const gen = generateConstructorPlan(ctx, {
      targets,
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "three_main_two_snacks",
      primary_meal_slot: "lunch",
    });
    const lines: string[] = [];
    lines.push(`valid ${gen.is_valid}`);
    lines.push(`message ${gen.message ?? ""}`);
    lines.push(`best ${gen.diagnostics?.best_recipe_slugs?.join(", ")}`);
    lines.push(`reason ${gen.diagnostics?.last_failure_reason}`);

    const slugs = gen.diagnostics?.best_recipe_slugs ?? [
      "egg-chicken-buckwheat",
      "chicken-buckwheat-carrot",
      "rice-chicken-vegetables",
      "cheese-cucumber-crispbread",
      "tuna-avocado-crispbread",
    ];
    const recipes = slugs.map((s) => ctx.recipes.find((r) => r.slug === s)!);
    const shares = slotCalorieShare("three_main_two_snacks");
    const slots = ["main1", "main2", "main3", "snack1", "snack2"] as const;
    const priorities = macroPriorities(targets);
    const excluded = new Set<string>();
    const dayCtx = {
      products: ctx.products,
      recipeIngredients: ctx.recipeIngredients,
      recipes: ctx.recipes,
    };
    const items = slots.map((slot, i) => {
      const recipe = recipes[i]!;
      let ings = verifiedIngredients(ctx, recipe, excluded);
      if (slot.startsWith("main")) {
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
    const snap = displayMacro(solved.totals);
    lines.push(`manual valid=${solved.valid} P=${snap.protein_g} F=${snap.fat_g} C=${snap.carbs_g} K=${snap.kcal}`);
    lines.push(
      `diff P=${(snap.protein_g - 135).toFixed(2)} F=${(snap.fat_g - 60).toFixed(2)} C=${(snap.carbs_g - 180).toFixed(2)} K=${(snap.kcal - 1800).toFixed(2)}`,
    );
    for (const item of solved.items) {
      const recipe = ctx.recipes.find((r) => r.id === item.recipe_id)!;
      const bounds = ctx.recipeIngredients.get(item.recipe_id) ?? [];
      const parts = item.ingredients.map((ing) => {
        const p = ctx.products.get(ing.product_id)!;
        const b = bounds.find((x) => x.product_id === ing.product_id);
        const oilBound = p.slug.includes("oil") ? { min_g: 0, max_g: 15 } : null;
        const min = b?.min_g ?? oilBound?.min_g ?? 0;
        const max = b?.max_g ?? oilBound?.max_g ?? 0;
        return `${p.slug}:${ing.grams}[${min}-${max}]`;
      });
      lines.push(`${item.slot} ${recipe.slug} :: ${parts.join(" | ")}`);
    }
    writeFileSync("_debug-1800-out.txt", lines.join("\n"), "utf8");
  });
});
