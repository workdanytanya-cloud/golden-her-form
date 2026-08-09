/**
 * Применяет seed упражнений в Supabase через REST (service role).
 * Запуск: node scripts/apply-exercises-seed.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadEnv() {
  const raw = fs.readFileSync(path.join(root, ".env"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
  return env;
}

const env = loadEnv();
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env");
  process.exit(1);
}

// Re-parse from the same generator data / SQL rows — easier: import CSV and upsert via PostgREST
const csv = fs.readFileSync(path.join(__dirname, "exercises-sheet.csv"), "utf8");

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

function classify(name) {
  const n = name.toLowerCase();
  if (n === "разминка") {
    return {
      category: "warmup",
      muscle_groups: ["всё тело"],
      equipment: ["mat"],
      difficulty: "beginner",
      tags: ["home", "warmup", "sheet"],
      description: "Общая разминка перед тренировкой (видео из библиотеки тренера).",
    };
  }
  if (n === "заминка") {
    return {
      category: "cooldown",
      muscle_groups: ["всё тело"],
      equipment: ["mat"],
      difficulty: "beginner",
      tags: ["home", "cooldown", "sheet"],
      description: "Заминка после тренировки (видео из библиотеки тренера).",
    };
  }
  if (n === "тренировка") {
    return {
      category: "strength_full",
      muscle_groups: ["всё тело"],
      equipment: ["mat", "dumbbell"],
      difficulty: "intermediate",
      tags: ["home", "circuit", "sheet"],
      description: "Круговая тренировка целиком — выполнить 2 круга по видео.",
    };
  }
  let category = "strength_full";
  let muscle_groups = ["всё тело"];
  let equipment = ["mat"];
  let difficulty = "beginner";
  if (/выпад|присед|наклон.*ног|одной ноге/.test(n)) {
    category = "strength_lower";
    muscle_groups = ["ягодицы", "квадрицепс", "задняя поверхность бедра"];
  } else if (/пресс|лодочк|планке/.test(n) && !/подъем рук|отжим/.test(n)) {
    category = "core";
    muscle_groups = ["кор", "пресс"];
  } else if (/отжим|подъем рук|рук из планки/.test(n)) {
    category = "strength_upper";
    muscle_groups = ["грудные", "плечи", "трицепс", "кор"];
  }
  if (/гантел/.test(n)) equipment = ["dumbbell", "mat"];
  if (/прыжк/.test(n)) difficulty = "intermediate";
  const tags = ["home", "sheet"];
  if (/прыжк/.test(n)) tags.push("jumping");
  else tags.push("low_impact");
  if (/гантел/.test(n)) tags.push("dumbbell");
  return {
    category,
    muscle_groups,
    equipment,
    difficulty,
    tags,
    description:
      "Упражнение из программы тренера. Ориентир по времени/подходам — из таблицы; техника — по видео.",
  };
}

function parseTiming(raw) {
  const t = (raw || "").trim().toLowerCase();
  if (!t || t.includes("выполняем")) return { sets: 1, reps: "по видео", rest: 30 };
  if (/подход/.test(t)) {
    const m = t.match(/(\d+)/);
    return { sets: m ? Number(m[1]) : 3, reps: "10-12", rest: 60 };
  }
  if (/мин/.test(t)) return { sets: 1, reps: t.replace(/\.$/, ""), rest: 30 };
  if (/круг/.test(t)) return { sets: 2, reps: "круг", rest: 60 };
  return { sets: 1, reps: t || "по видео", rest: 45 };
}

const rows = parseCsv(csv).slice(1);
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
  if (/^повторить\s*круг/i.test(name)) continue;
  if (!video) continue;
  const key = video;
  const meta = classify(name);
  const timingParsed = parseTiming(timing);
  if (!byKey.has(key)) {
    byKey.set(key, {
      slug: `sheet-${slugify(name) || "exercise"}`,
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

const used = new Set();
const payload = [];
for (const ex of byKey.values()) {
  let s = ex.slug;
  let i = 2;
  while (used.has(s)) s = `${ex.slug}-${i++}`;
  used.add(s);
  const tags = [...ex.tags];
  for (const w of ex.workouts) {
    const m = w.match(/№\s*(\d+)/);
    if (m) tags.push(`workout_${m[1]}`);
  }
  const description = [
    ex.description,
    ex.timingNote ? `Ориентир: ${ex.timingNote}.` : null,
    ex.workouts.length ? `Входит в: ${ex.workouts.join(", ")}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  payload.push({
    slug: s,
    name: ex.name,
    category: ex.category,
    muscle_groups: ex.muscle_groups,
    equipment: ex.equipment,
    difficulty: ex.difficulty,
    tags: [...new Set(tags)],
    description,
    cues: ex.cues,
    common_mistakes: ex.common_mistakes,
    video_url: ex.video_url,
    default_sets: ex.default_sets,
    default_reps: ex.default_reps,
    tempo: null,
    rest_seconds: ex.rest_seconds,
  });
}

const endpoint = `${url.replace(/\/$/, "")}/rest/v1/exercises?on_conflict=slug`;
const res = await fetch(endpoint, {
  method: "POST",
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=representation",
  },
  body: JSON.stringify(payload),
});

const body = await res.text();
if (!res.ok) {
  console.error("FAIL", res.status, body);
  process.exit(1);
}

const inserted = JSON.parse(body);
console.log(`OK: upserted ${inserted.length} exercises`);
for (const e of inserted) console.log(`- ${e.slug}: ${e.name}`);

// verify count with sheet tag
const check = await fetch(
  `${url.replace(/\/$/, "")}/rest/v1/exercises?select=slug&tags=cs.{sheet}`,
  {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  },
);
const checkBody = await check.json();
console.log(`Verify sheet-tagged count: ${checkBody.length}`);
