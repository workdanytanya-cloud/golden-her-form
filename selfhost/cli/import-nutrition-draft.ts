import fs from "node:fs";
import path from "node:path";
import { loadSelfhostEnvFiles } from "../../src/lib/selfhost/load-env";
import { closePostgresPool, getPostgresPool } from "../../src/lib/selfhost/db";
import {
  loadConstructorPlanPg,
  loadOptimizerContextPg,
  saveConstructorPlanPg,
} from "../../src/lib/selfhost/postgres-nutrition";
import { resolveClientCourseIdPg } from "../../src/lib/selfhost/postgres-courses";
import {
  assertDaysWithinTargets,
  buildConstructorDaysFromParsedMenu,
  parseNutritionMenuMarkdown,
} from "../../src/lib/nutrition-constructor/parse-nutrition-menu-md";
import type { FoodProduct } from "../../src/lib/nutrition-constructor/types";

loadSelfhostEnvFiles();

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main() {
  const clientId = arg("--client-id")?.trim();
  const file = arg("--file")?.trim();
  const courseIdArg = arg("--course-id")?.trim() || null;
  const dryRun = hasFlag("--dry-run");
  if (!clientId) throw new Error("Укажите --client-id <uuid>");
  if (!file) throw new Error("Укажите --file <path-to-markdown>");

  const markdown = fs.readFileSync(path.resolve(file), "utf8");
  const parsed = parseNutritionMenuMarkdown(markdown);
  if (parsed.days.length !== 7) {
    throw new Error(`Ожидалось 7 дней, получено ${parsed.days.length}`);
  }

  const pool = getPostgresPool();
  try {
    const ctx = await loadOptimizerContextPg(pool);
    const productsBySlug = new Map<string, FoodProduct>();
    for (const product of ctx.products.values()) {
      productsBySlug.set(product.slug, product);
    }
    const days = buildConstructorDaysFromParsedMenu(parsed, productsBySlug);
    assertDaysWithinTargets(days, parsed.targets);

    const courseId = await resolveClientCourseIdPg(pool, clientId, courseIdArg);
    if (!courseId) throw new Error("Активный курс клиента не найден");

    if (dryRun) {
      console.log(
        JSON.stringify(
          {
            dryRun: true,
            clientId,
            courseId,
            days: days.length,
            targets: parsed.targets,
            sample: days[0]?.items.map((item) => ({
              slot: item.slot,
              name: item.recipe_name,
              ingredients: item.ingredients.map((ing) => ({
                name: ing.product_name,
                grams: ing.grams,
              })),
            })),
            prepPlanLines: parsed.prepPlan.length,
            shoppingItems: parsed.shoppingList.length,
          },
          null,
          2,
        ),
      );
      return;
    }

    await saveConstructorPlanPg(pool, {
      userId: clientId,
      courseId,
      days,
      targets: parsed.targets,
      plan_days_count: 7,
      plan_status: "validated",
      notes: parsed.notes,
      targets_manual: true,
      meal_schedule_mode: "three_mains_only",
      primary_meal_slot: "lunch",
      requires_manual_review: false,
      review_reason: null,
    });

    const loaded = await loadConstructorPlanPg(pool, clientId, courseId);
    if (!loaded.plan || loaded.days.length !== 7) {
      throw new Error("Черновик после сохранения не содержит 7 дней");
    }
    assertDaysWithinTargets(loaded.days, parsed.targets);

    console.log(
      JSON.stringify(
        {
          ok: true,
          clientId,
          courseId,
          planId: loaded.plan.id,
          days: loaded.days.length,
          dayNames: loaded.days.map((day) =>
            day.items.map((item) => item.recipe_name),
          ),
        },
        null,
        2,
      ),
    );
  } finally {
    await closePostgresPool();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
