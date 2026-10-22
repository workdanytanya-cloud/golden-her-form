import { displayGrams, d } from "@/lib/nutrition-constructor/decimal-math";
import { shoppingListFromDays } from "@/lib/nutrition-constructor/ingredient-normalize";
import { constructorDaysFromSnapshot } from "@/lib/published-programs/nutrition-snapshot";
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
  main1: "Завтрак",
  main2: "Обед",
  main3: "Ужин",
  snack1: "Перекус 1",
  snack2: "Перекус 2",
  snack3: "Перекус 3",
  breakfast: "Завтрак",
  lunch: "Обед",
  dinner: "Ужин",
  snack: "Перекус",
};

function slotLabel(slot: string): string {
  return SLOT_LABEL[slot] ?? slot;
}

function safeDateToken(issuedAt: string): string {
  const day = issuedAt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "date";
}

function clientNameSlug(clientName: string): string {
  return clientName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9а-яё\-]/gi, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function pdfFileName(kind: PdfKind, issuedAt: string, clientName?: string): string {
  const day = safeDateToken(issuedAt);
  const base = kind === "nutrition" ? "panovapro-nutrition" : "panovapro-training";
  const slug = clientName ? clientNameSlug(clientName) : "";
  return slug ? `${base}-${slug}-${day}.pdf` : `${base}-${day}.pdf`;
}

function formatMacroLine(kcal: string, protein: string, fat: string, carbs: string): string {
  const k = d(kcal).toDecimalPlaces(0).toNumber();
  const p = d(protein).toDecimalPlaces(1).toNumber();
  const f = d(fat).toDecimalPlaces(1).toNumber();
  const c = d(carbs).toDecimalPlaces(1).toNumber();
  return `${k} ккал, Б ${p} г, Ж ${f} г, У ${c} г`;
}

export type PdfLineBlock = {
  keepTogether?: boolean;
  lines: string[];
};

function extractNotesSection(notes: string | null | undefined, heading: string): string[] {
  if (!notes) return [];
  const re = new RegExp(`^##\\s*${heading}\\s*$`, "im");
  const match = notes.match(re);
  if (!match || match.index == null) return [];
  const start = match.index + match[0].length;
  const rest = notes.slice(start);
  const next = rest.search(/^##\s+/m);
  const body = (next >= 0 ? rest.slice(0, next) : rest).trim();
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Округляет граммы в строках списка покупок для клиентского PDF. */
function roundShoppingLineGrams(line: string): string {
  return line.replace(/([\d\s]+(?:[.,]\d+)?)\s*г/gi, (_full, raw: string) => {
    const n = Number(String(raw).replace(/\s+/g, "").replace(",", "."));
    if (!Number.isFinite(n)) return `${raw} г`;
    return `${Math.round(n)} г`;
  });
}

export function nutritionPdfBlocks(snapshot: NutritionSnapshot, meta: PdfClientMeta): PdfLineBlock[] {
  const safeStart = meta.courseStart.includes("NaN") ? "—" : meta.courseStart;
  const safeEnd = meta.courseEnd.includes("NaN") ? "—" : meta.courseEnd;
  const safeIssued = safeDateToken(meta.issuedAt);

  const blocks: PdfLineBlock[] = [
    {
      lines: [
        "PanovaPRO — питание",
        `Клиент: ${meta.clientName}`,
        `Курс: ${meta.courseTitle}`,
        `Даты курса: ${safeStart} — ${safeEnd}`,
        `Дата выдачи: ${safeIssued}`,
        `Целевые КБЖУ: ${formatMacroLine(
          String(snapshot.targets.kcal),
          String(snapshot.targets.protein_g),
          String(snapshot.targets.fat_g),
          String(snapshot.targets.carbs_g),
        )}`,
      ],
    },
  ];

  const preface = (snapshot.notes ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("##"));
  const prefaceUntilPrep = [];
  for (const line of preface) {
    if (/^план заготовок|^хранение|^список покупок/i.test(line)) break;
    prefaceUntilPrep.push(line);
  }
  if (prefaceUntilPrep.length > 0) {
    blocks.push({ lines: ["", "Комментарий тренера:", ...prefaceUntilPrep] });
  }

  if (snapshot.kind === "constructor") {
    for (const day of snapshot.constructor_days) {
      blocks.push({
        lines: [
          "",
          `День ${day.day_index + 1}${day.day_note ? ` — ${day.day_note}` : ""}`,
          `Итого дня: ${formatMacroLine(day.kcal, day.protein_g, day.fat_g, day.carbs_g)}`,
        ],
      });
      for (const item of day.items) {
        const mealLines = [
          `${slotLabel(item.slot)}: ${item.recipe_name}`,
          `  КБЖУ: ${formatMacroLine(item.kcal, item.protein_g, item.fat_g, item.carbs_g)}`,
        ];
        for (const ing of item.ingredients) {
          mealLines.push(`  • ${ing.product_name} — ${displayGrams(ing.grams)} г`);
        }
        if (item.steps?.length) {
          for (const step of item.steps) {
            mealLines.push(`  Инструкция: ${step}`);
          }
        }
        if (item.prep_time_min != null) {
          mealLines.push(`  Активное время: ${item.prep_time_min} мин`);
        }
        blocks.push({ keepTogether: true, lines: mealLines });
      }
    }

    const prep = extractNotesSection(snapshot.notes, "План заготовок");
    const storage = extractNotesSection(snapshot.notes, "Хранение");
    const shoppingFromNotes = extractNotesSection(snapshot.notes, "Список покупок");
    if (prep.length > 0) {
      blocks.push({ lines: ["", "План заготовок:", ...prep.map((line) => `  ${line}`)] });
    }
    if (storage.length > 0) {
      blocks.push({ lines: ["", "Хранение:", ...storage.map((line) => `  ${line}`)] });
    }
    const shopping = shoppingListFromDays(constructorDaysFromSnapshot(snapshot));
    if (shopping.length > 0) {
      blocks.push({
        lines: [
          "",
          "Список покупок:",
          ...shopping.map((entry) => `  • ${entry.product_name} — ${Math.round(entry.grams)} г`),
        ],
      });
    } else if (shoppingFromNotes.length > 0) {
      blocks.push({
        lines: [
          "",
          "Список покупок:",
          ...shoppingFromNotes.map((line) => `  ${roundShoppingLineGrams(line)}`),
        ],
      });
    }
  } else {
    for (const day of snapshot.legacy_days) {
      blocks.push({
        lines: ["", `День ${day.day_index + 1}${day.day_note ? ` — ${day.day_note}` : ""}`],
      });
      for (const meal of day.meals) {
        blocks.push({
          keepTogether: true,
          lines: [
            `${slotLabel(meal.slot)}: ${meal.dish.name} — ${Math.round(meal.portion_g)} г`,
            `  На 100 г: ${meal.dish.calories_per_100g} ккал, Б ${meal.dish.protein_per_100g} г, Ж ${meal.dish.fat_per_100g} г, У ${meal.dish.carbs_per_100g} г`,
          ],
        });
      }
    }
  }
  return blocks;
}

export function nutritionPdfLines(snapshot: NutritionSnapshot, meta: PdfClientMeta): string[] {
  return nutritionPdfBlocks(snapshot, meta).flatMap((block) => block.lines);
}

function sectionSets(
  title: string,
  sets: TrainingSnapshot["days"][number]["warmup"],
  overlay?: Map<string, import("@/lib/exercise-video").ExerciseVideo>,
  weekIndex?: number,
  dayIndex?: number,
  section?: "warmup" | "exercises" | "cooldown",
): string[] {
  const lines = [`${title}:`];
  if (sets.length === 0) {
    lines.push("  нет");
    return lines;
  }
  for (const [index, set] of sets.entries()) {
    const ex = set.exercise;
    const name = ex?.name ?? "Упражнение";
    lines.push(
      `  ${name}: ${set.sets}×${set.reps}, отдых ${set.rest_seconds} с${set.tempo ? `, темп ${set.tempo}` : ""}`,
    );
    if (ex?.cues?.length) lines.push(`    Подсказки: ${ex.cues.join("; ")}`);
    const key =
      weekIndex != null && dayIndex != null && section
        ? `${weekIndex}:${dayIndex}:${section}:${index}`
        : null;
    const overlayVideo =
      (set.exercise_id && overlay?.get(set.exercise_id)) ||
      (ex?.id && overlay?.get(ex.id)) ||
      (key && overlay?.get(key)) ||
      null;
    const video = overlayVideo ?? (ex ? videoFromFrozenExercise(ex) : null);
    if (video?.url) lines.push(`    Видео: ${video.title ? `${video.title} — ` : ""}${video.url}`);
    else if (video?.fallback_text) lines.push(`    ${video.fallback_text}`);
    else if (ex || overlayVideo) lines.push("    Видео недоступно — выполняйте по подсказкам");
  }
  return lines;
}

export function trainingPdfLines(
  snapshot: TrainingSnapshot,
  meta: PdfClientMeta,
  mediaOverlay?: Map<string, import("@/lib/exercise-video").ExerciseVideo>,
): string[] {
  const safeStart = meta.courseStart.includes("NaN") ? "—" : meta.courseStart;
  const safeEnd = meta.courseEnd.includes("NaN") ? "—" : meta.courseEnd;
  const lines: string[] = [
    "PanovaPRO — тренировки",
    `Клиент: ${meta.clientName}`,
    `Курс: ${meta.courseTitle}`,
    `Даты курса: ${safeStart} — ${safeEnd}`,
    `Дата выдачи: ${safeDateToken(meta.issuedAt)}`,
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
      const weekIndex = day.week_index ?? 0;
      lines.push(...sectionSets("Разминка", day.warmup, mediaOverlay, weekIndex, day.day_index, "warmup"));
      lines.push(
        ...sectionSets(
          "Основные упражнения",
          day.exercises,
          mediaOverlay,
          weekIndex,
          day.day_index,
          "exercises",
        ),
      );
      lines.push(...sectionSets("Заминка", day.cooldown, mediaOverlay, weekIndex, day.day_index, "cooldown"));
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
