import { describe, expect, it } from "vitest";
import { DEFAULT_TOLERANCE } from "@/lib/nutrition-constructor/config";
import { d, displayMacro, withinTolerance } from "@/lib/nutrition-constructor/decimal-math";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";

const TARGETS_1726 = {
  kcal: d(1726),
  protein_g: d(99),
  fat_g: d(49.5),
  carbs_g: d(221.2),
  fiber_g: d(0),
};

const SEEDS = [1, 42, 1726] as const;

function isGrainSlug(slug: string): boolean {
  return /oats|buckwheat|rice|pasta|quinoa|bulgur|porridge|cereal|греч|рис|овсян|паст/i.test(slug);
}

function dominantProteinId(item: {
  ingredients: Array<{ product_id: string; protein_g: string }>;
}): string {
  let best = "";
  let bestP = -1;
  for (const ing of item.ingredients) {
    const p = Number(ing.protein_g);
    if (p > bestP) {
      bestP = p;
      best = ing.product_id;
    }
  }
  return best;
}

describe("regression 1726 three_mains_only", () => {
  const ctx = buildInMemoryCatalog({ includeTestPackaging: true });

  it("1 day PASS within strict tolerance", { timeout: 90_000 }, () => {
    const gen = generateConstructorPlan(ctx, {
      targets: TARGETS_1726,
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "three_mains_only",
      primary_meal_slot: "lunch",
      seed: 1,
    });
    expect(gen.is_valid, gen.message ?? "invalid").toBe(true);
    expect(gen.reason_code).toBe("PASS");
    expect(gen.days).toHaveLength(1);
    const day = gen.days[0]!;
    expect(
      withinTolerance(
        {
          kcal: d(day.kcal),
          protein_g: d(day.protein_g),
          fat_g: d(day.fat_g),
          carbs_g: d(day.carbs_g),
          fiber_g: d(0),
        },
        TARGETS_1726,
        DEFAULT_TOLERANCE,
      ),
    ).toBe(true);
    expect(day.items.filter((i) => i.slot.startsWith("main"))).toHaveLength(3);
    expect(day.items.filter((i) => i.slot.startsWith("snack"))).toHaveLength(0);
    for (const item of day.items) {
      expect(item.ingredients.length).toBeGreaterThan(0);
      for (const ing of item.ingredients) {
        expect(Number(ing.grams)).toBeGreaterThan(0);
      }
    }
  });

  it("7/7 days PASS within strict tolerance", { timeout: 180_000 }, () => {
    const t0 = Date.now();
    const gen = generateConstructorPlan(ctx, {
      targets: TARGETS_1726,
      days_count: 7,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "three_mains_only",
      primary_meal_slot: "lunch",
      seed: 1,
    });
    const elapsed = Date.now() - t0;
    expect(gen.is_valid, gen.message ?? "invalid").toBe(true);
    expect(gen.days).toHaveLength(7);
    const perDay = [];
    for (const day of gen.days) {
      const disp = displayMacro({
        kcal: d(day.kcal),
        protein_g: d(day.protein_g),
        fat_g: d(day.fat_g),
        carbs_g: d(day.carbs_g),
        fiber_g: d(0),
      });
      perDay.push({ day: day.day_index, ...disp });
      expect(
        withinTolerance(
          {
            kcal: d(day.kcal),
            protein_g: d(day.protein_g),
            fat_g: d(day.fat_g),
            carbs_g: d(day.carbs_g),
            fiber_g: d(0),
          },
          TARGETS_1726,
          DEFAULT_TOLERANCE,
        ),
        `day ${day.day_index}`,
      ).toBe(true);
      expect(day.items.filter((i) => i.slot.startsWith("main"))).toHaveLength(3);
      expect(day.items.filter((i) => i.slot.startsWith("snack"))).toHaveLength(0);

      const mains = day.items.filter((i) => i.slot.startsWith("main"));
      const proteins = mains.map((m) => dominantProteinId(m));
      // Не три одинаковых белка.
      expect(new Set(proteins).size, `day ${day.day_index} identical protein×3`).toBeGreaterThan(1);
      expect(
        proteins.every((p) => p === proteins[0]),
        `day ${day.day_index} all same protein`,
      ).toBe(false);

      const grainKeys = mains.map((m) => {
        const recipe = ctx.recipes.find((r) => r.id === m.recipe_id);
        if (!recipe || !isGrainSlug(recipe.slug)) return `non-grain:${m.recipe_id}`;
        return recipe.slug;
      });
      const grainOnly = grainKeys.filter((k) => !k.startsWith("non-grain:"));
      if (grainOnly.length === 3) {
        expect(new Set(grainOnly).size, `day ${day.day_index} identical grain×3`).toBeGreaterThan(
          1,
        );
      }

      for (const item of day.items) {
        for (const ing of item.ingredients) {
          expect(Number(ing.grams)).toBeGreaterThan(0);
          expect(Number(ing.grams)).toBeLessThanOrEqual(500);
        }
      }
    }
    console.log({
      elapsed_ms: elapsed,
      gen_ms: gen.diagnostics?.elapsed_ms,
      week_tiled: gen.diagnostics?.week_tiled,
      unique_week_days: gen.diagnostics?.unique_week_days,
      checked: gen.diagnostics?.combinations_checked,
      timed_out: gen.diagnostics?.timed_out,
      used_fallback: gen.diagnostics?.used_fallback,
      per_day: perDay,
    });
  });

  for (const seed of SEEDS) {
    it(`reproducible PASS with seed=${seed}`, { timeout: 120_000 }, () => {
      const a = generateConstructorPlan(ctx, {
        targets: TARGETS_1726,
        days_count: 1,
        excluded_product_ids: [],
        tolerance: DEFAULT_TOLERANCE,
        meal_schedule_mode: "three_mains_only",
        primary_meal_slot: "lunch",
        seed,
      });
      const b = generateConstructorPlan(ctx, {
        targets: TARGETS_1726,
        days_count: 1,
        excluded_product_ids: [],
        tolerance: DEFAULT_TOLERANCE,
        meal_schedule_mode: "three_mains_only",
        primary_meal_slot: "lunch",
        seed,
      });
      expect(a.is_valid, a.message ?? "a invalid").toBe(true);
      expect(b.is_valid, b.message ?? "b invalid").toBe(true);
      expect(a.days[0]!.kcal).toBe(b.days[0]!.kcal);
      expect(a.days[0]!.protein_g).toBe(b.days[0]!.protein_g);
      expect(a.days[0]!.items.map((i) => i.recipe_id).join(",")).toBe(
        b.days[0]!.items.map((i) => i.recipe_id).join(","),
      );
    });
  }
});
