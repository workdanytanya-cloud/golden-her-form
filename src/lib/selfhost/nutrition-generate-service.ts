import { z } from "zod";
import {
  countReplacedMeals,
  freshRebuildSeed,
  rebuildSaveDecision,
} from "@/lib/nutrition-constructor/meal-replace";
import { generateAndValidateConstructorPlan } from "@/lib/nutrition-constructor/repo";
import { getPostgresPool } from "@/lib/selfhost/db";
import { loadRebuildExclusions } from "@/lib/selfhost/postgres-meal-replace";
import {
  loadConstructorPlanPg,
  nutritionGenerateSchema,
  saveConstructorPlanPg,
} from "@/lib/selfhost/postgres-nutrition";
import { assertCourseScopePg } from "@/lib/selfhost/postgres-courses";
import type { NutritionComputePayload } from "@/lib/selfhost/nutrition-job-queue";

export type NutritionGenerateBody = z.infer<typeof nutritionGenerateSchema>;

type GeneratedPlan = NutritionComputePayload["generated"] & {
  days: Array<{ day_index: number; items: Array<{ slot: string; recipe_id: string }> }>;
  targets: {
    kcal: number;
    protein_g: number;
    fat_g: number;
    carbs_g: number;
  };
  bmr: number;
  tdee: number;
  adjustment_pct: number;
  requires_manual_review?: boolean;
  review_reason?: string | null;
  message?: string;
  is_valid?: boolean;
};

function asGenerated(value: unknown): GeneratedPlan {
  return value as GeneratedPlan;
}

export async function computeNutritionGenerate(input: unknown): Promise<NutritionComputePayload> {
  const body = nutritionGenerateSchema.parse(input);
  const generateWith = (extra: {
    seed?: number;
    excluded_recipe_ids?: string[];
    excluded_variant_groups?: string[];
    excluded_ingredient_signatures?: string[];
    search_timeout_ms?: number;
    catalog?: "postgres" | "memory";
  }) =>
    generateAndValidateConstructorPlan({
      clientId: body.clientId,
      courseId: body.courseId,
      seed: extra.seed ?? body.seed,
      profile: body.profile as never,
      days_count: body.days_count,
      excluded_product_ids: body.excluded_product_ids,
      excluded_recipe_ids: extra.excluded_recipe_ids ?? body.excluded_recipe_ids,
      excluded_variant_groups: extra.excluded_variant_groups ?? body.excluded_variant_groups,
      excluded_ingredient_signatures:
        extra.excluded_ingredient_signatures ?? body.excluded_ingredient_signatures,
      allow_repeats: body.allow_repeats,
      meal_schedule_mode: body.meal_schedule_mode,
      primary_meal_slot: body.primary_meal_slot,
      targets_override: body.targets_override,
      search_timeout_ms: extra.search_timeout_ms ?? body.search_timeout_ms,
      catalog: extra.catalog,
    });

  if (!body.rebuild || !body.clientId) {
    const generated = asGenerated(await generateWith({}));
    return {
      generated,
      changed: generated.days?.length ?? 0,
      total: generated.days?.length ?? 0,
      hadDraft: false,
    };
  }

  const exclusions = await loadRebuildExclusions(getPostgresPool(), body.clientId, body.courseId);
  const before = await loadConstructorPlanPg(getPostgresPool(), body.clientId, body.courseId);
  const timeout = body.search_timeout_ms ?? (body.days_count > 7 ? 80_000 : 40_000);
  const targetSeed = Math.round(body.targets_override?.kcal ?? 0) || undefined;
  const seeds = [
    targetSeed,
    freshRebuildSeed(undefined, targetSeed),
    freshRebuildSeed(Date.now() + 104729, targetSeed),
  ].filter((value, index, all): value is number => value != null && all.indexOf(value) === index);
  let fallback: GeneratedPlan | null = null;
  let chosen: GeneratedPlan | null = null;
  for (let index = 0; index < seeds.length; index += 1) {
    const seed = seeds[index]!;
    const pass = asGenerated(
      await generateWith({
        seed,
        excluded_recipe_ids:
          index === 0
            ? [...new Set([...body.excluded_recipe_ids, ...exclusions.recipeIds])]
            : body.excluded_recipe_ids,
        excluded_variant_groups:
          index === 0
            ? [...new Set([...body.excluded_variant_groups, ...exclusions.variantGroups])]
            : body.excluded_variant_groups,
        excluded_ingredient_signatures:
          index === 0
            ? [...new Set([...body.excluded_ingredient_signatures, ...exclusions.signatures])]
            : body.excluded_ingredient_signatures,
        search_timeout_ms: timeout,
      }),
    );
    const diff = countReplacedMeals(before.days, pass.days ?? []);
    const annotated = Object.assign(pass, {
      changed: diff.changed,
      total: diff.total,
      hadDraft: exclusions.hadDraft,
    });
    const useful =
      pass.is_valid && pass.days.length > 0 && (!exclusions.hadDraft || diff.changed > 0);
    if (useful) {
      chosen = annotated;
      break;
    }
    if (!fallback || (pass.is_valid && pass.days.length > 0)) fallback = annotated;
    if (pass.reason_code === "INSUFFICIENT_VARIETY" || pass.reason_code === "INFEASIBLE") break;
  }
  if (!chosen) {
    const memory = asGenerated(
      await generateWith({
        catalog: "memory",
        seed: targetSeed ?? seeds[0],
        search_timeout_ms: timeout,
        excluded_recipe_ids: body.excluded_recipe_ids,
        excluded_variant_groups: body.excluded_variant_groups,
        excluded_ingredient_signatures: body.excluded_ingredient_signatures,
      }),
    );
    const memoryDiff = countReplacedMeals(before.days, memory.days ?? []);
    if (
      memory.is_valid &&
      memory.days.length > 0 &&
      (!exclusions.hadDraft || memoryDiff.changed > 0)
    ) {
      chosen = Object.assign(memory, {
        changed: memoryDiff.changed,
        total: memoryDiff.total,
        hadDraft: exclusions.hadDraft,
      });
    } else {
      chosen = fallback ?? memory;
    }
  }
  return {
    generated: chosen,
    changed: Number((chosen as { changed?: number }).changed ?? chosen.days.length),
    total: Number((chosen as { total?: number }).total ?? chosen.days.length),
    hadDraft: Boolean((chosen as { hadDraft?: boolean }).hadDraft ?? false),
  };
}

export async function saveNutritionGenerateResult(
  body: NutritionGenerateBody,
  payload: NutritionComputePayload,
): Promise<Record<string, unknown>> {
  const generated = asGenerated(payload.generated);
  const changed = payload.changed;
  const total = payload.total;
  const hadDraft = payload.hadDraft;
  const decision = body.rebuild
    ? rebuildSaveDecision({
        valid: Boolean(generated.is_valid && generated.days.length > 0),
        changed,
        total,
        hadDraft,
      })
    : {
        save: Boolean(generated.is_valid && generated.days.length > 0),
        success: Boolean(generated.is_valid && generated.days.length > 0),
        message: generated.message ?? "",
      };
  if (!decision.save || generated.days.length === 0) {
    return {
      ...generated,
      saved: false,
      changed,
      total,
      message: body.rebuild ? decision.message : generated.message,
    };
  }
  if (!body.clientId) {
    throw Object.assign(new Error("Не указан clientId для сохранения черновика"), {
      statusCode: 400,
    });
  }
  await assertCourseScopePg(getPostgresPool(), body.clientId, body.courseId, "nutrition");
  const beforeSave = body.rebuild
    ? await loadConstructorPlanPg(getPostgresPool(), body.clientId, body.courseId)
    : null;
  const targets = body.targets_override ?? {
    kcal: Number(generated.targets.kcal),
    protein_g: Number(generated.targets.protein_g),
    fat_g: Number(generated.targets.fat_g),
    carbs_g: Number(generated.targets.carbs_g),
  };
  const saved = await saveConstructorPlanPg(getPostgresPool(), {
    userId: body.clientId,
    courseId: body.courseId,
    days: generated.days as never,
    targets,
    plan_days_count: body.days_count,
    plan_status: "validated",
    bmr: Number(generated.bmr),
    tdee: Number(generated.tdee),
    calorie_adjustment_pct: generated.adjustment_pct,
    excluded_products: body.excluded_product_ids,
    targets_manual: Boolean(body.targets_override),
    meal_schedule_mode: body.meal_schedule_mode,
    primary_meal_slot: body.primary_meal_slot,
    requires_manual_review: generated.requires_manual_review,
    review_reason: generated.review_reason,
  });
  const confirmed = beforeSave
    ? countReplacedMeals(beforeSave.days, saved.days)
    : {
        changed: saved.days.flatMap((day) => day.items).length,
        total: saved.days.flatMap((day) => day.items).length,
      };
  if (body.rebuild && confirmed.changed === 0) {
    return {
      ...generated,
      saved: false,
      changed: 0,
      total: confirmed.total,
      days: beforeSave?.days ?? [],
      message:
        "Новый отличающийся вариант найти не удалось. Текущий рацион сохранён без изменений.",
    };
  }
  return {
    ...generated,
    saved: true,
    changed: body.rebuild ? confirmed.changed : saved.days.flatMap((day) => day.items).length,
    total: body.rebuild ? confirmed.total : saved.days.flatMap((day) => day.items).length,
    message: body.rebuild
      ? `Рацион пересобран: изменено ${confirmed.changed} из ${confirmed.total} приёмов`
      : generated.message,
    draftId: saved.plan.id,
    days: saved.days,
  };
}
