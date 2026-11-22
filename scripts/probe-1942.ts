/**
 * Probe: 7d / one_main_three_snacks / 1942 kcal high-protein.
 * Run: npx tsx scripts/probe-1942.ts
 */
import { DEFAULT_TOLERANCE } from "@/lib/nutrition-constructor/config";
import { d } from "@/lib/nutrition-constructor/decimal-math";
import { buildExactWeek } from "@/lib/nutrition-constructor/exact-week-search";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import { evaluateStrictWeekVariety } from "@/lib/nutrition-constructor/recipe-variety";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import { isAutoGenerationEligible } from "@/lib/nutrition-constructor/recipe-selection";

const targets = {
  kcal: d(1942),
  protein_g: d(178.2),
  fat_g: d(89.1),
  carbs_g: d(106.8),
  fiber_g: d(0),
};

const ctx = buildInMemoryCatalog();
const mode = "one_main_three_snacks" as const;

const mains = ctx.mainRecipes.filter(
  (r) =>
    r.is_active &&
    isAutoGenerationEligible(r) &&
    r.allowed_schedule_modes.includes(mode),
);
const snacks = ctx.snackRecipes.filter(
  (r) =>
    r.is_active &&
    isAutoGenerationEligible(r) &&
    r.allowed_schedule_modes.includes(mode) &&
    !r.requires_cooking,
);

console.log(
  JSON.stringify(
    {
      mains: mains.length,
      snacksNoCook: snacks.length,
      proteins: [...new Set(mains.map((r) => r.primary_protein))].sort(),
      snackProteins: [...new Set(snacks.map((r) => r.primary_protein))].sort(),
    },
    null,
    2,
  ),
);

const harvest = buildExactWeek({
  ctx,
  mode,
  targets,
  tolerance: DEFAULT_TOLERANCE,
  days: 7,
  seed: 1942,
  excluded: new Set(),
  deadlineMs: Date.now() + 45_000,
  harvest: true,
  harvestLimit: 80,
});
console.log(
  "harvest exact days:",
  harvest.days.length,
  "checked:",
  harvest.checked,
  "timedOut:",
  harvest.timedOut,
);

const strict = buildExactWeek({
  ctx,
  mode,
  targets,
  tolerance: DEFAULT_TOLERANCE,
  days: 7,
  seed: 1942,
  excluded: new Set(),
  deadlineMs: Date.now() + 45_000,
});
console.log(
  "strict pool days:",
  strict.days.length,
  "checked:",
  strict.checked,
  "timedOut:",
  strict.timedOut,
);

const started = Date.now();
const plan = generateConstructorPlan(ctx, {
  targets,
  days_count: 7,
  excluded_product_ids: [],
  tolerance: DEFAULT_TOLERANCE,
  meal_schedule_mode: mode,
  primary_meal_slot: "lunch",
  seed: 1942,
  search_timeout_ms: 60_000,
});
const ms = Date.now() - started;
const recipes = new Map(ctx.recipes.map((r) => [r.id, r]));
let variety = "";
if (plan.is_valid) {
  const issue = evaluateStrictWeekVariety(plan.days, recipes, { allowRepeats: false });
  variety = issue?.detail ?? "ok";
}
console.log(
  JSON.stringify(
    {
      ms,
      valid: plan.is_valid,
      reason: plan.reason_code,
      message: plan.message,
      days: plan.days.length,
      meals: plan.days.reduce((n, day) => n + day.items.length, 0),
      variety,
      diagnostics: plan.diagnostics,
    },
    null,
    2,
  ),
);

if (plan.is_valid) {
  for (const day of plan.days) {
    const delta = {
      k: Math.abs(Number(day.kcal) - 1942),
      p: Math.abs(Number(day.protein_g) - 178.2),
      f: Math.abs(Number(day.fat_g) - 89.1),
      c: Math.abs(Number(day.carbs_g) - 106.8),
    };
    console.log(
      `day ${day.day_index}: Δk=${delta.k.toFixed(2)} Δp=${delta.p.toFixed(2)} Δf=${delta.f.toFixed(2)} Δc=${delta.c.toFixed(2)} | ${day.items.map((i) => i.recipe_name).join(" / ")}`,
    );
  }
}
