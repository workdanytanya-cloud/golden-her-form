/**
 * Генерирует SQL seed из panova-exercises.json (все вкладки таблицы).
 *
 * node scripts/fetch-exercises-sheet.mjs
 * node scripts/collect-panova-exercises.mjs
 * node scripts/generate-exercises-from-sheet.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COACH_SHEET_URL,
  buildExercisesSeedSql,
} from "./exercises-sheet.lib.mjs";
import { collectExercisesFromTabsDir } from "./collect-panova-exercises.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jsonPath = path.join(__dirname, "panova-exercises.json");
const outPath = path.join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260813220000_coach_exercises_panova_sheet.sql",
);
const dataOut = path.join(__dirname, "..", "src", "lib", "panova-sheet-data.ts");

const tabsDir = path.join(__dirname, "_sheet_tabs");
let exercises;
if (fs.existsSync(tabsDir) && fs.readdirSync(tabsDir).some((f) => f.endsWith(".csv"))) {
  const collected = collectExercisesFromTabsDir(tabsDir);
  exercises = collected.exercises;
  fs.writeFileSync(jsonPath, JSON.stringify(exercises, null, 2), "utf8");
} else if (fs.existsSync(jsonPath)) {
  exercises = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
} else {
  console.error("Нет данных. Сначала: node scripts/fetch-exercises-sheet.mjs");
  process.exit(1);
}

if (!exercises.length) {
  console.error("Список упражнений пуст");
  process.exit(1);
}

const sql = buildExercisesSeedSql(exercises, { sourceUrl: COACH_SHEET_URL });
fs.writeFileSync(outPath, sql, "utf8");

// 4-week program data for runtime
let programJson = { weeks: [] };
const programPath = path.join(__dirname, "panova-4week-program.json");
if (!fs.existsSync(programPath)) {
  console.warn("Нет panova-4week-program.json — запустите node scripts/parse-panova-4week.mjs");
} else {
  programJson = JSON.parse(fs.readFileSync(programPath, "utf8"));
}

const byVideo = Object.fromEntries(exercises.map((e) => [e.video_url, e.slug]));
const weeksPayload = (programJson.weeks || []).map((w) => ({
  weekIndex: w.weekIndex,
  workouts: (w.workouts || []).map((wo) => ({
    title: wo.title,
    focus: wo.focus,
    items: (wo.items || []).map((it) => ({
      slug: byVideo[it.video_url] || null,
      name: it.name,
      video_url: it.video_url,
      sets: it.sets,
      reps: it.reps,
      rest_seconds: it.rest_seconds,
      note: it.note,
      section: it.section,
    })),
  })),
}));

const ts = `/* eslint-disable */
/** Auto-generated from Google Sheet — do not edit by hand.
 * Source: ${COACH_SHEET_URL}
 * Exercises: ${exercises.length}
 */
export const PANOVA_SHEET_SOURCE = ${JSON.stringify(COACH_SHEET_URL)};

export type PanovaSheetItem = {
  slug: string | null;
  name: string;
  video_url: string;
  sets: number;
  reps: string;
  rest_seconds: number;
  note: string | null;
  section: "warmup" | "exercises" | "cooldown";
};

export type PanovaSheetWorkout = {
  title: string;
  focus: string | null;
  items: PanovaSheetItem[];
};

export type PanovaSheetWeek = {
  weekIndex: number;
  workouts: PanovaSheetWorkout[];
};

export const PANOVA_SHEET_SLUGS: readonly string[] = ${JSON.stringify(
  exercises.map((e) => e.slug),
  null,
  2,
)} as const;

export const PANOVA_4WEEK_PROGRAM: readonly PanovaSheetWeek[] = ${JSON.stringify(
  weeksPayload,
  null,
  2,
)} as const;
`;

fs.writeFileSync(dataOut, ts, "utf8");

const desktop = path.join(process.env.USERPROFILE || "", "Desktop", "panovapro-seed-exercises.sql");
try {
  fs.copyFileSync(outPath, desktop);
  console.log(`Copied to ${desktop}`);
} catch (e) {
  console.warn("Desktop copy skipped:", e.message);
}

console.log(`Wrote ${exercises.length} exercises → ${outPath}`);
console.log(`Wrote runtime data → ${dataOut}`);
console.log(
  `4-week items with slug: ${weeksPayload
    .flatMap((w) => w.workouts)
    .flatMap((wo) => wo.items)
    .filter((i) => i.slug).length}`,
);
