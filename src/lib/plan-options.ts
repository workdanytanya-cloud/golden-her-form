/** Опции рациона: сложность рецептов и паттерн приёмов (в т.ч. «для занятых»). */

export type RecipeComplexity = "any" | "simple" | "complex";
export type MealPattern = "standard" | "busy";
/** UI-выбор режима приёмов. busy = 2 полноценных + 3 перекуса без готовки. */
export type MealsChoice = 3 | 5 | "busy";

const CX_PREFIX = "__cx:";
const PT_PREFIX = "__pt:";

export function isPlanMetaToken(token: string): boolean {
  return token.startsWith(CX_PREFIX) || token.startsWith(PT_PREFIX);
}

export function stripPlanMeta(preferred: string[] | null | undefined): string[] {
  return (preferred ?? []).filter((p) => !isPlanMetaToken(p));
}

export function decodePlanMeta(preferred: string[] | null | undefined): {
  foods: string[];
  complexity: RecipeComplexity;
  pattern: MealPattern;
} {
  let complexity: RecipeComplexity = "any";
  let pattern: MealPattern = "standard";
  const foods: string[] = [];
  for (const p of preferred ?? []) {
    if (p.startsWith(CX_PREFIX)) {
      const v = p.slice(CX_PREFIX.length);
      if (v === "simple" || v === "complex" || v === "any") complexity = v;
      continue;
    }
    if (p.startsWith(PT_PREFIX)) {
      const v = p.slice(PT_PREFIX.length);
      if (v === "busy" || v === "standard") pattern = v;
      continue;
    }
    foods.push(p);
  }
  return { foods, complexity, pattern };
}

export function encodePlanMeta(
  foods: string[],
  opts: { complexity: RecipeComplexity; pattern: MealPattern },
): string[] {
  const cleaned = foods.filter((p) => !isPlanMetaToken(p));
  return [`${CX_PREFIX}${opts.complexity}`, `${PT_PREFIX}${opts.pattern}`, ...cleaned];
}

export function mealsChoiceFromPlan(
  mealsPerDay: number | null | undefined,
  preferred: string[] | null | undefined,
): MealsChoice {
  const { pattern } = decodePlanMeta(preferred);
  if (pattern === "busy") return "busy";
  return mealsPerDay === 3 ? 3 : 5;
}

export function mealsChoiceToStored(choice: MealsChoice): {
  mealsPerDay: 3 | 5;
  pattern: MealPattern;
} {
  if (choice === "busy") return { mealsPerDay: 5, pattern: "busy" };
  if (choice === 3) return { mealsPerDay: 3, pattern: "standard" };
  return { mealsPerDay: 5, pattern: "standard" };
}

export function mealsChoiceLabel(choice: MealsChoice): string {
  if (choice === 3) return "3 приёма пищи";
  if (choice === "busy") return "2 приёма + 3 перекуса без готовки";
  return "5 приёмов пищи";
}

export function complexityLabel(c: RecipeComplexity): string {
  if (c === "simple") return "простые рецепты";
  if (c === "complex") return "сложные многосоставные";
  return "любые рецепты";
}
