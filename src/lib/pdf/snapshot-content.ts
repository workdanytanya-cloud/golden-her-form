import type { NutritionSnapshot, TrainingSnapshot } from "@/lib/published-programs/types";
import { videoFromFrozenExercise } from "@/lib/published-programs/training-snapshot";

export type PdfKind = "nutrition" | "training";

export type PdfClientMeta = {
  clientName: string;
  courseTitle: string;
  courseStart: string;
  courseEnd: string;
  issuedAt: string;
};

export type PdfAccessOk = { ok: true; clientId: string };
export type PdfAccessErr = { ok: false; status: 401 | 403 | 404; message: string };

export function resolvePdfClientId(params: {
  sessionUserId: string | null;
  isAdmin: boolean;
  requestedClientId?: string | null;
}): PdfAccessOk | PdfAccessErr {
  if (!params.sessionUserId) {
    return { ok: false, status: 401, message: "Нужно войти в кабинет" };
  }
  if (!params.requestedClientId || params.requestedClientId === params.sessionUserId) {
    return { ok: true, clientId: params.sessionUserId };
  }
  if (!params.isAdmin) {
    return { ok: false, status: 403, message: "Нельзя скачать программу другого клиента" };
  }
  return { ok: true, clientId: params.requestedClientId };
}

export function requirePublishedSnapshot<T>(
  record: {
    source?: string;
    snapshot: T;
    version: { status: string } | null;
  } | null,
): { snapshot: T; issuedAt: string } | PdfAccessErr {
  if (!record || record.source !== "published" || record.version?.status !== "published") {
    return { ok: false, status: 404, message: "Опубликованная программа ещё не выдана" };
  }
  return {
    snapshot: record.snapshot,
    issuedAt: new Date().toISOString().slice(0, 10),
  };
}

const SLOT_LABEL: Record<string, string> = {
  main1: "Основной приём 1",
  main2: "Основной приём 2",
  main3: "Основной приём 3",
  snack1: "Перекус 1",
  snack2: "Перекус 2",
  breakfast: "Завтрак",
  lunch: "Обед",
  dinner: "Ужин",
  snack: "Перекус",
};

function slotLabel(slot: string): string {
  return SLOT_LABEL[slot] ?? slot;
}

export function pdfFileName(kind: PdfKind, issuedAt: string): string {
  const day = issuedAt.slice(0, 10);
  return kind === "nutrition" ? `panovapro-nutrition-${day}.pdf` : `panovapro-training-${day}.pdf`;
}

export function nutritionPdfLines(snapshot: NutritionSnapshot, meta: PdfClientMeta): string[] {
  const lines: string[] = [
    "PanovaPRO — питание",
    `Клиент: ${meta.clientName}`,
    `Курс: ${meta.courseTitle}`,
    `Даты курса: ${meta.courseStart} — ${meta.courseEnd}`,
    `Дата выдачи: ${meta.issuedAt}`,
    `Целевые КБЖУ: ${snapshot.targets.kcal} ккал, Б ${snapshot.targets.protein_g} г, Ж ${snapshot.targets.fat_g} г, У ${snapshot.targets.carbs_g} г`,
  ];
  if (snapshot.notes) lines.push(`Комментарий тренера: ${snapshot.notes}`);

  if (snapshot.kind === "constructor") {
    for (const day of snapshot.constructor_days) {
      lines.push("");
      lines.push(`День ${day.day_index + 1}${day.day_note ? ` — ${day.day_note}` : ""}`);
      lines.push(
        `Итого дня: ${day.kcal} ккал, Б ${day.protein_g} г, Ж ${day.fat_g} г, У ${day.carbs_g} г`,
      );
      for (const item of day.items) {
        lines.push(`${slotLabel(item.slot)}: ${item.recipe_name}`);
        lines.push(
          `  КБЖУ: ${item.kcal} ккал, Б ${item.protein_g} г, Ж ${item.fat_g} г, У ${item.carbs_g} г`,
        );
        for (const ing of item.ingredients) {
          lines.push(`  • ${ing.product_name} — ${ing.grams} г`);
        }
      }
    }
  } else {
    for (const day of snapshot.legacy_days) {
      lines.push("");
      lines.push(`День ${day.day_index + 1}${day.day_note ? ` — ${day.day_note}` : ""}`);
      for (const meal of day.meals) {
        lines.push(`${slotLabel(meal.slot)}: ${meal.dish.name} — ${meal.portion_g} г`);
        lines.push(
          `  На 100 г: ${meal.dish.calories_per_100g} ккал, Б ${meal.dish.protein_per_100g} г, Ж ${meal.dish.fat_per_100g} г, У ${meal.dish.carbs_per_100g} г`,
        );
      }
    }
  }
  return lines;
}

function sectionSets(title: string, sets: TrainingSnapshot["days"][number]["warmup"]): string[] {
  const lines = [`${title}:`];
  if (sets.length === 0) {
    lines.push("  нет");
    return lines;
  }
  for (const set of sets) {
    const ex = set.exercise;
    const name = ex?.name ?? "Упражнение";
    lines.push(
      `  ${name}: ${set.sets}×${set.reps}, отдых ${set.rest_seconds} с${set.tempo ? `, темп ${set.tempo}` : ""}`,
    );
    if (ex?.cues?.length) lines.push(`    Подсказки: ${ex.cues.join("; ")}`);
    if (ex) {
      const video = videoFromFrozenExercise(ex);
      if (video.url) lines.push(`    Видео: ${video.title ? `${video.title} — ` : ""}${video.url}`);
      else if (video.fallback_text) lines.push(`    ${video.fallback_text}`);
      else lines.push("    Видео недоступно — выполняйте по подсказкам");
    }
  }
  return lines;
}

export function trainingPdfLines(snapshot: TrainingSnapshot, meta: PdfClientMeta): string[] {
  const lines: string[] = [
    "PanovaPRO — тренировки",
    `Клиент: ${meta.clientName}`,
    `Курс: ${meta.courseTitle}`,
    `Даты курса: ${meta.courseStart} — ${meta.courseEnd}`,
    `Дата выдачи: ${meta.issuedAt}`,
    `Программа: ${snapshot.name}`,
  ];
  const byWeek = new Map<number, typeof snapshot.days>();
  for (const day of snapshot.days) {
    const week = day.week_index ?? 0;
    const list = byWeek.get(week) ?? [];
    list.push(day);
    byWeek.set(week, list);
  }
  for (const week of [...byWeek.keys()].sort((a, b) => a - b)) {
    lines.push("");
    lines.push(`Неделя ${week + 1}`);
    for (const day of byWeek.get(week) ?? []) {
      lines.push(
        `День ${day.day_index + 1}: ${day.title}${day.is_rest ? " (отдых)" : ""}${day.focus ? ` — ${day.focus}` : ""}`,
      );
      if (day.is_rest) continue;
      lines.push(...sectionSets("Разминка", day.warmup));
      lines.push(...sectionSets("Основные упражнения", day.exercises));
      lines.push(...sectionSets("Заминка", day.cooldown));
    }
  }
  return lines;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(?:\+7|8)\s*\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/;

export function pdfTextHasForbiddenPii(text: string): boolean {
  return UUID_RE.test(text) || EMAIL_RE.test(text) || PHONE_RE.test(text);
}
