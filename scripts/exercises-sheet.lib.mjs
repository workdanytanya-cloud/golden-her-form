/**
 * Парсинг Google Sheet тренера → упражнения для Supabase.
 * Источник: https://docs.google.com/spreadsheets/d/1SU_RzbakfsSb5UAb7u1JO0yvib3GI8rPQa3E4_5Xa3g
 */

export const COACH_SHEET_ID = "1SU_RzbakfsSb5UAb7u1JO0yvib3GI8rPQa3E4_5Xa3g";
export const COACH_SHEET_URL = `https://docs.google.com/spreadsheets/d/${COACH_SHEET_ID}/edit`;

export function sheetCsvExportUrl(gid = "0") {
  return `https://docs.google.com/spreadsheets/d/${COACH_SHEET_ID}/export?format=csv&gid=${gid}`;
}

export function slugify(name) {
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

export function escSql(s) {
  return String(s).replace(/'/g, "''");
}

export function arrSql(a) {
  return `ARRAY[${a.map((x) => `'${escSql(x)}'`).join(",")}]::text[]`;
}

export function jsonbSql(v) {
  return `'${escSql(JSON.stringify(v))}'::jsonb`;
}

/** Эвристика категории / мышц / оборудования по названию */
export function classifyExercise(name) {
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

  if (/разминк/.test(n)) {
    return {
      category: "warmup",
      muscles: ["всё тело"],
      equipment: ["mat"],
      difficulty: "beginner",
      tags: ["home", "warmup", "sheet"],
      description: "Разминка перед тренировкой (видео тренера).",
    };
  }
  if (/заминк/.test(n)) {
    return {
      category: "cooldown",
      muscles: ["всё тело"],
      equipment: ["mat"],
      difficulty: "beginner",
      tags: ["home", "cooldown", "sheet"],
      description: "Заминка после тренировки (видео тренера).",
    };
  }
  if (/табата|комплекс|кругов/.test(n)) {
    category = "strength_full";
    muscles = ["всё тело"];
    difficulty = "intermediate";
  } else if (/выпад|присед|мост|ягодиц|тяг.*ног|отведен.*ног|зашаг|мертв|ступен|носк|стульчик/.test(n)) {
    category = "strength_lower";
    muscles = ["ягодицы", "квадрицепс", "задняя поверхность бедра"];
  } else if (/пресс|скручив|лодочк|планке|планка|книжк|сетап|твист/.test(n)) {
    category = "core";
    muscles = ["кор", "пресс"];
  } else if (
    /отжим|тяга|жим|бицепс|трицепс|плеч|гантел|разводк|махи|пронац|трастер|супермен|спин|грудь|эспандер|резинк.*тяг|амортизатор/.test(
      n,
    )
  ) {
    category = "strength_upper";
    muscles = ["спина", "плечи", "руки"];
  } else if (/бег|скалолаз|прыж/.test(n)) {
    category = "cardio";
    muscles = ["всё тело"];
    difficulty = "intermediate";
  }

  if (/гантел|гир/.test(n)) equipment = ["dumbbell", "mat"];
  if (/резин|амортизатор|эспандер/.test(n)) equipment = ["band", "mat"];
  if (/стул/.test(n)) equipment = [...new Set([...equipment, "chair"])];
  if (/прыжк|табата/.test(n)) difficulty = "intermediate";

  const tags = ["home", "sheet"];
  if (/прыжк|табата/.test(n)) tags.push("jumping", "high_impact");
  else tags.push("low_impact");
  if (/гантел|гир/.test(n)) tags.push("dumbbell");
  if (/резин|амортизатор|эспандер/.test(n)) tags.push("band");
  if (/стул/.test(n)) tags.push("chair");

  return {
    category,
    muscles,
    equipment,
    difficulty,
    tags,
    description:
      "Упражнение из программы тренера. Ориентир по времени/подходам — из таблицы; техника — по видео.",
  };
}

export function parseTiming(raw) {
  const t = (raw || "").trim().toLowerCase();
  if (!t || t.includes("выполняем")) {
    return { sets: 1, reps: "по видео", rest: 30 };
  }
  if (/подход/.test(t)) {
    const m = t.match(/(\d+)/);
    return { sets: m ? Number(m[1]) : 3, reps: "10-12", rest: 60 };
  }
  if (/мин/.test(t)) {
    return { sets: 1, reps: t.replace(/\.$/, ""), rest: 30 };
  }
  if (/круг/.test(t)) {
    return { sets: 2, reps: "круг", rest: 60 };
  }
  return { sets: 1, reps: t || "по видео", rest: 45 };
}

export function parseCsv(text) {
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

/** Rutube / YouTube → embed URL (дублирует src/lib/video-embed.ts для скриптов). */
export function getVideoEmbedUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "rutube.ru" || host === "rutube.com") {
      const m = u.pathname.match(/\/video\/(?:private\/)?([a-f0-9]{32})\/?/i);
      if (!m) return null;
      const p = u.searchParams.get("p");
      const embed = new URL(`https://rutube.ru/play/embed/${m[1]}/`);
      if (p) embed.searchParams.set("p", p);
      return embed.toString();
    }
    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
      const id =
        u.searchParams.get("v") ||
        u.pathname.match(/\/embed\/([^/?#]+)/)?.[1] ||
        u.pathname.match(/\/shorts\/([^/?#]+)/)?.[1];
      if (!id) return null;
      return `https://www.youtube.com/embed/${id}`;
    }
    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      if (!id) return null;
      return `https://www.youtube.com/embed/${id}`;
    }
    return null;
  } catch {
    return null;
  }
}

export function parseExercisesFromCsv(text) {
  const rows = parseCsv(text).slice(1);
  const byKey = new Map();
  let workout = null;

  for (const cols of rows) {
    const name = (cols[0] || "").trim();
    if (name.startsWith("#")) continue;
    const timing = (cols[1] || "").trim();
    const video = (cols[2] || "").trim();
    if (!name) continue;

    if (/^тренировка\s*№/i.test(name)) {
      workout = name;
      continue;
    }
    if (SKIP_NAME.test(name) && !video) continue;
    if (!video) continue;

    const key = video || name.toLowerCase();
    const meta = classifyExercise(name);
    const timingParsed = parseTiming(timing);
    const baseSlug = slugify(name) || "exercise";

    if (!byKey.has(key)) {
      byKey.set(key, {
        slug: `sheet-${baseSlug}`,
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
  const exercises = [];
  for (const ex of byKey.values()) {
    let s = ex.slug;
    let i = 2;
    while (used.has(s)) {
      s = `${ex.slug}-${i++}`;
    }
    used.add(s);
    ex.slug = s;

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

    exercises.push({
      slug: ex.slug,
      name: ex.name,
      category: ex.category,
      muscle_groups: ex.muscles,
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

  return exercises;
}

export function buildExercisesSeedSql(exercises, { sourceUrl = COACH_SHEET_URL } = {}) {
  const lines = [];
  lines.push(`-- Seed упражнений из Google Sheet тренера`);
  lines.push(`-- Источник: ${sourceUrl}`);
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
    const row = `(
  '${escSql(ex.slug)}',
  '${escSql(ex.name)}',
  '${ex.category}',
  ${arrSql(ex.muscle_groups)},
  ${arrSql(ex.equipment)},
  '${ex.difficulty}',
  ${arrSql(ex.tags)},
  '${escSql(ex.description)}',
  ${jsonbSql(ex.cues)},
  ${jsonbSql(ex.common_mistakes)},
  '${escSql(ex.video_url)}',
  ${ex.default_sets},
  '${escSql(ex.default_reps)}',
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
  return lines.join("\n");
}
