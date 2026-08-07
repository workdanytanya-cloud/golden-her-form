/**
 * Парсит Google Sheet (CSV) тренировок Т. Пановой и генерирует SQL seed упражнений.
 * Источник: https://docs.google.com/spreadsheets/d/13tuqIgdPAP3U7PfMakse3hIvZkBCwSbNjJIaUeYmahQ
 *
 * Запуск: node scripts/generate-exercises-from-sheet.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const csvPath = path.join(__dirname, "exercises-sheet.csv");
const outPath = path.join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260807220000_seed_exercises_from_sheet.sql",
);

function slugify(name) {
  const map = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
    ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return name
    .toLowerCase()
    .trim()
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function esc(s) {
  return String(s).replace(/'/g, "''");
}

function arr(a) {
  return `ARRAY[${a.map((x) => `'${esc(x)}'`).join(",")}]::text[]`;
}

function jsonb(v) {
  return `'${esc(JSON.stringify(v))}'::jsonb`;
}

/** Эвристика категории / мышц / оборудования по названию */
function classify(name) {
  const n = name.toLowerCase();
  if (n === "разминка") {
    return {
      category: "warmup",
      muscles: ["всё тело"],
      equipment: ["mat"],
      difficulty: "beginner",
      tags: ["home", "warmup", "sheet"],
      description: "Общая разминка перед тренировкой (видео из библиотеки тренера).",
    };
  }
  if (n === "заминка") {
    return {
      category: "cooldown",
      muscles: ["всё тело"],
      equipment: ["mat"],
      difficulty: "beginner",
      tags: ["home", "cooldown", "sheet"],
      description: "Заминка после тренировки (видео из библиотеки тренера).",
    };
  }
  if (n === "тренировка") {
    return {
      category: "strength_full",
      muscles: ["всё тело"],
      equipment: ["mat", "dumbbell"],
      difficulty: "intermediate",
      tags: ["home", "circuit", "sheet"],
      description: "Круговая тренировка целиком — выполнить 2 круга по видео.",
    };
  }

  let category = "strength_full";
  let muscles = ["всё тело"];
  let equipment = ["mat"];
  let difficulty = "beginner";

  if (/выпад|присед|наклон.*ног|одной ноге/.test(n)) {
    category = "strength_lower";
    muscles = ["ягодицы", "квадрицепс", "задняя поверхность бедра"];
  } else if (/пресс|лодочк|планке/.test(n) && !/подъем рук|отжим/.test(n)) {
    category = "core";
    muscles = ["кор", "пресс"];
  } else if (/отжим|подъем рук|рук из планки/.test(n)) {
    category = "strength_upper";
    muscles = ["грудные", "плечи", "трицепс", "кор"];
  }

  if (/гантел/.test(n)) equipment = ["dumbbell", "mat"];
  if (/прыжк/.test(n)) {
    difficulty = "intermediate";
  }

  const tags = ["home", "sheet"];
  if (/прыжк/.test(n)) tags.push("jumping");
  else tags.push("low_impact");
  if (/гантел/.test(n)) tags.push("dumbbell");

  return {
    category,
    muscles,
    equipment,
    difficulty,
    tags,
    description: `Упражнение из программы тренера. Ориентир по времени/подходам — из таблицы; техника — по видео.`,
  };
}

function parseTiming(raw) {
  const t = (raw || "").trim().toLowerCase();
  if (!t || t.includes("выполняем")) {
    return { sets: 1, reps: "по видео", rest: 30 };
  }
  if (/подход/.test(t)) {
    const m = t.match(/(\d+)/);
    return { sets: m ? Number(m[1]) : 3, reps: "10-12", rest: 60 };
  }
  if (/мин/.test(t)) {
    // "1 мин на каждую сторону" / "2 мин"
    return { sets: 1, reps: t.replace(/\.$/, ""), rest: 30 };
  }
  if (/круг/.test(t)) {
    return { sets: 2, reps: "круг", rest: 60 };
  }
  return { sets: 1, reps: t || "по видео", rest: 45 };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (q) {
      if (c === '"' && n === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\n" || (c === "\r" && n === "\n")) {
      if (c === "\r") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else if (c !== "\r") cur += c;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

const SKIP_NAME = /^(упражнение|тренировка\s*№\d+|повторить\s*круг)/i;

const text = fs.readFileSync(csvPath, "utf8");
const rows = parseCsv(text).slice(1); // skip header

/** @type {Map<string, any>} */
const byKey = new Map();
let workout = null;

for (const cols of rows) {
  const name = (cols[0] || "").trim();
  const timing = (cols[1] || "").trim();
  const video = (cols[2] || "").trim();
  if (!name) continue;

  if (/^тренировка\s*№/i.test(name)) {
    workout = name;
    continue;
  }
  if (SKIP_NAME.test(name) && !video) continue;
  if (!video) continue; // notes without video

  const key = video || name.toLowerCase();
  const meta = classify(name);
  const timingParsed = parseTiming(timing);
  const baseSlug = slugify(name) || "exercise";
  let slug = `sheet-${baseSlug}`;

  if (!byKey.has(key)) {
    byKey.set(key, {
      slug,
      name: name.replace(/\s+/g, " ").trim(),
      ...meta,
      video_url: video,
      default_sets: timingParsed.sets,
      default_reps: timingParsed.reps,
      rest_seconds: timingParsed.rest,
      cues: ["Смотрите технику на видео тренера", "Дышите ровно, без задержек"],
      common_mistakes: ["Спешка и потеря контроля", "Выполнение через боль"],
      workouts: workout ? [workout] : [],
      timingNote: timing || null,
    });
  } else {
    const ex = byKey.get(key);
    if (workout && !ex.workouts.includes(workout)) ex.workouts.push(workout);
  }
}

// ensure unique slugs
const used = new Set();
for (const ex of byKey.values()) {
  let s = ex.slug;
  let i = 2;
  while (used.has(s)) {
    s = `${ex.slug}-${i++}`;
  }
  ex.slug = s;
  used.add(s);
}

const exercises = [...byKey.values()];

const lines = [];
lines.push(`-- Seed упражнений из Google Sheet тренера`);
lines.push(`-- Источник: https://docs.google.com/spreadsheets/d/13tuqIgdPAP3U7PfMakse3hIvZkBCwSbNjJIaUeYmahQ`);
lines.push(`-- Сгенерировано scripts/generate-exercises-from-sheet.mjs`);
lines.push(`-- Уникальных упражнений: ${exercises.length}`);
lines.push(``);
lines.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.exercises TO authenticated;`);
lines.push(``);
lines.push(`INSERT INTO public.exercises (`);
lines.push(`  slug, name, category, muscle_groups, equipment, difficulty, tags,`);
lines.push(`  description, cues, common_mistakes, video_url,`);
lines.push(`  default_sets, default_reps, tempo, rest_seconds`);
lines.push(`) VALUES`);

const valueRows = exercises.map((ex, idx) => {
  const tags = [...ex.tags];
  for (const w of ex.workouts) {
    const m = w.match(/№\s*(\d+)/);
    if (m) tags.push(`workout_${m[1]}`);
  }
  const desc = [
    ex.description,
    ex.timingNote ? `Ориентир: ${ex.timingNote}.` : null,
    ex.workouts.length ? `Входит в: ${ex.workouts.join(", ")}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const row = `(
  '${esc(ex.slug)}',
  '${esc(ex.name)}',
  '${ex.category}',
  ${arr(ex.muscles)},
  ${arr(ex.equipment)},
  '${ex.difficulty}',
  ${arr([...new Set(tags)])},
  '${esc(desc)}',
  ${jsonb(ex.cues)},
  ${jsonb(ex.common_mistakes)},
  '${esc(ex.video_url)}',
  ${ex.default_sets},
  '${esc(ex.default_reps)}',
  NULL,
  ${ex.rest_seconds}
)`;
  return row + (idx < exercises.length - 1 ? "," : "");
});

lines.push(...valueRows);
lines.push(`ON CONFLICT (slug) DO UPDATE SET`);
lines.push(`  name = EXCLUDED.name,`);
lines.push(`  category = EXCLUDED.category,`);
lines.push(`  muscle_groups = EXCLUDED.muscle_groups,`);
lines.push(`  equipment = EXCLUDED.equipment,`);
lines.push(`  difficulty = EXCLUDED.difficulty,`);
lines.push(`  tags = EXCLUDED.tags,`);
lines.push(`  description = EXCLUDED.description,`);
lines.push(`  cues = EXCLUDED.cues,`);
lines.push(`  common_mistakes = EXCLUDED.common_mistakes,`);
lines.push(`  video_url = EXCLUDED.video_url,`);
lines.push(`  default_sets = EXCLUDED.default_sets,`);
lines.push(`  default_reps = EXCLUDED.default_reps,`);
lines.push(`  rest_seconds = EXCLUDED.rest_seconds,`);
lines.push(`  updated_at = now();`);
lines.push(``);

fs.writeFileSync(outPath, lines.join("\n"), "utf8");

const desktop = path.join(process.env.USERPROFILE || "", "Desktop", "panovapro-seed-exercises.sql");
try {
  fs.copyFileSync(outPath, desktop);
  console.log(`Copied to ${desktop}`);
} catch (e) {
  console.warn("Desktop copy skipped:", e.message);
}

console.log(`Wrote ${exercises.length} exercises → ${outPath}`);
for (const ex of exercises) {
  console.log(`- [${ex.category}] ${ex.name} (${ex.default_sets}×${ex.default_reps})`);
}
