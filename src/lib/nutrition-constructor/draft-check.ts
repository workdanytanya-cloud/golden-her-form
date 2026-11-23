import { nutritionPdfBlocks } from "@/lib/pdf/snapshot-content";
import { d } from "@/lib/nutrition-constructor/decimal-math";
import {
  slotsForMode,
  slotLabel,
  type MealScheduleMode,
  type PlanSlot,
} from "@/lib/nutrition-constructor/config";
import { shoppingListFromDays } from "@/lib/nutrition-constructor/ingredient-normalize";
import { evaluatePlanKbjuStatus } from "@/lib/nutrition-constructor/plan-kbju-status";
import {
  validateRecipeInstruction,
  type InstructionIngredient,
} from "@/lib/nutrition-constructor/recipe-instructions";
import { technicalNameReason } from "@/lib/nutrition-constructor/recipe-names";
import type { ConstructorDay, FoodProduct } from "@/lib/nutrition-constructor/types";

export type DraftIssue = {
  dayIndex: number;
  slot: PlanSlot | null;
  message: string;
};

function num(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function checkNutritionDraft(params: {
  days: ConstructorDay[];
  targets: { kcal: number; protein_g: number; fat_g: number; carbs_g: number };
  mode: MealScheduleMode;
  products: Map<string, FoodProduct>;
  expectedDays?: number;
  /** Тренер явно подтвердил публикацию вне допуска КБЖУ. */
  allowOutOfToleranceKbju?: boolean;
}): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const expected = params.expectedDays ?? 7;
  if (params.days.length !== expected) {
    issues.push({
      dayIndex: 0,
      slot: null,
      message: `В черновике ${params.days.length} дн., для публикации нужно ${expected}`,
    });
  }
  const seen = new Map<string, string>();
  const required = slotsForMode(params.mode);
  for (const day of params.days) {
    const present = new Set(day.items.map((item) => item.slot));
    for (const slot of required) {
      if (!present.has(slot)) {
        issues.push({
          dayIndex: day.day_index,
          slot,
          message: `${slotLabel(slot, params.mode)}: приём не заполнен`,
        });
      }
    }
    for (const item of day.items) {
      const nameIssue = technicalNameReason(item.recipe_name);
      if (nameIssue) {
        issues.push({
          dayIndex: day.day_index,
          slot: item.slot,
          message: `${item.recipe_name}: ${nameIssue}`,
        });
      }
      const repeatKey = item.recipe_id || item.recipe_name;
      const where = seen.get(repeatKey);
      if (where) {
        issues.push({
          dayIndex: day.day_index,
          slot: item.slot,
          message: `«${item.recipe_name}» уже используется (${where})`,
        });
      } else {
        seen.set(repeatKey, `день ${day.day_index + 1}, ${slotLabel(item.slot, params.mode)}`);
      }
      if (item.ingredients.length === 0) {
        issues.push({
          dayIndex: day.day_index,
          slot: item.slot,
          message: "В приёме нет продуктов",
        });
      }
      const instructionIngredients: InstructionIngredient[] = [];
      for (const line of item.ingredients) {
        const grams = num(line.grams);
        if (grams <= 0) {
          issues.push({
            dayIndex: day.day_index,
            slot: item.slot,
            message: `${line.product_name || "Продукт"}: граммы должны быть больше нуля`,
          });
        }
        const product =
          params.products.get(line.product_id) ??
          [...params.products.values()].find((row) => row.slug === line.product_id);
        if (!line.product_id || !line.product_name) {
          issues.push({
            dayIndex: day.day_index,
            slot: item.slot,
            message: "В приёме есть строка без продукта",
          });
        }
        instructionIngredients.push({
          slug: product?.slug ?? line.product_id,
          name: product?.name ?? line.product_name,
          category: product?.category,
          state: product?.state,
          requiresCooking: product?.requires_cooking,
        });
      }
      const instructionIssues = validateRecipeInstruction({
        name: item.recipe_name,
        requiresCooking: item.requires_cooking,
        ingredients: instructionIngredients,
        steps: item.steps ?? [],
      });
      if (instructionIssues.length > 0) {
        issues.push({
          dayIndex: day.day_index,
          slot: item.slot,
          message: `Инструкция «${item.recipe_name}» не прошла проверку`,
        });
      }
    }
  }
  if (params.days.length > 0 && !params.allowOutOfToleranceKbju) {
    const status = evaluatePlanKbjuStatus({
      days: params.days,
      targetMacro: {
        kcal: d(params.targets.kcal),
        protein_g: d(params.targets.protein_g),
        fat_g: d(params.targets.fat_g),
        carbs_g: d(params.targets.carbs_g),
        fiber_g: d(0),
      },
      scheduleMode: params.mode,
      comparison: [],
    });
    if (!status.acceptable) {
      issues.push({
        dayIndex: status.invalidDayCount > 0 ? 0 : 0,
        slot: null,
        message:
          status.invalidDayCount > 0
            ? `${status.invalidDayCount} дн. выходят за допуск КБЖУ`
            : "Рацион не попадает в допуск КБЖУ",
      });
    }
  }
  try {
    shoppingListFromDays(params.days);
  } catch {
    issues.push({ dayIndex: 0, slot: null, message: "Список покупок не строится" });
  }
  try {
    nutritionPdfBlocks(
      {
        kind: "constructor",
        notes: "",
        targets: {
          kcal: String(params.targets.kcal),
          protein_g: String(params.targets.protein_g),
          fat_g: String(params.targets.fat_g),
          carbs_g: String(params.targets.carbs_g),
        },
        meal_schedule_mode: params.mode,
        primary_meal_slot: "lunch",
        constructor_days: params.days,
      } as never,
      {
        clientName: "Проверка",
        courseTitle: "Курс",
        courseStart: "2026-11-15",
        courseEnd: "2026-12-12",
        issuedAt: "2026-11-15",
      },
    );
  } catch {
    issues.push({ dayIndex: 0, slot: null, message: "PDF не строится" });
  }
  return issues;
}
