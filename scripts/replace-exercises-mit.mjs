/**
 * Удаляет импорт ExerciseDB (slug like edb-*) и загружает Open ExerciseDB (MIT).
 *
 * Источник: https://github.com/Glowupp-app/open-exercisedb
 * Лицензия: MIT — коммерческое использование и продажа разрешены.
 * Attribution желателен, но не обязателен.
 *
 *   node scripts/replace-exercises-mit.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(__dirname, "data");
const CACHE = path.join(DATA_DIR, "open-exercisedb-ru-cache.json");
const SOURCE =
  "https://raw.githubusercontent.com/Glowupp-app/open-exercisedb/main/exercises.json";

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    env[line.slice(0, i).trim()] = v;
  }
  return env;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function titleRu(s) {
  const t = String(s || "").trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function humanizeId(id) {
  return String(id || "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MUSCLE_RU = {
  "abs / core": "пресс",
  abs: "пресс",
  core: "пресс",
  "rectus abdominis": "пресс",
  obliques: "косые мышцы живота",
  "hip flexors": "сгибатели бедра",
  quadriceps: "квадрицепс",
  quads: "квадрицепс",
  "legs quads": "квадрицепс",
  glutes: "ягодицы",
  "gluteus maximus": "ягодицы",
  hamstrings: "задняя поверхность бедра",
  "legs hamstrings": "задняя поверхность бедра",
  calves: "икры",
  chest: "грудные",
  "pectoralis major": "грудные",
  lats: "широчайшие",
  "latissimus dorsi": "широчайшие",
  back: "спина",
  "erector spinae": "разгибатели спины",
  traps: "трапеции",
  shoulders: "плечи",
  deltoids: "плечи",
  "anterior deltoid": "передние дельты",
  "rear deltoid": "задние дельты",
  "posterior deltoid": "задние дельты",
  biceps: "бицепс",
  triceps: "трицепс",
  forearms: "предплечья",
  cardio: "кардио",
  "full body": "всё тело",
};

function ruMuscle(en) {
  const k = String(en || "").toLowerCase().trim();
  if (MUSCLE_RU[k]) return MUSCLE_RU[k];
  for (const [a, b] of Object.entries(MUSCLE_RU)) {
    if (k.includes(a)) return b;
  }
  return k || "всё тело";
}

const EQUIP_MAP = {
  bodyweight: "bodyweight",
  "body weight": "bodyweight",
  dumbbell: "dumbbell",
  dumbbells: "dumbbell",
  barbell: "barbell",
  kettlebell: "kettlebell",
  "resistance band": "band",
  band: "band",
  bands: "band",
  cable: "cable",
  machine: "machine",
  "leverage machine": "machine",
  "smith machine": "machine",
  "pull-up bar": "bodyweight",
  "medicine ball": "medicine_ball",
  "stability ball": "stability_ball",
  bench: "bench",
  mat: "mat",
};

function mapEquipment(list) {
  const tags = new Set();
  for (const raw of list || []) {
    const k = String(raw).toLowerCase().trim();
    tags.add(EQUIP_MAP[k] || "other");
  }
  if (tags.size === 0) tags.add("bodyweight");
  if ([...tags].some((t) => ["bodyweight", "band", "mat"].includes(t))) tags.add("mat");
  return [...tags];
}

function mapCategory(ex) {
  const blob = `${ex.name} ${ex.description || ""} ${ex.primary_muscle || ""} ${(ex.category || "")}`.toLowerCase();
  const primary = String(ex.primary_muscle || "").toLowerCase();

  if (/stretch|yoga|mobility|foam|warm.?up/.test(blob)) return "mobility";
  if (/cool.?down|recover/.test(blob)) return "cooldown";
  if (
    /cardio|run|jump|burpee|skip|hiit|bike|row/.test(blob) ||
    primary.includes("cardio")
  )
    return "cardio";
  if (
    /core|abs|oblique|plank|crunch|dead.?bug|hollow|twist/.test(blob) ||
    /abs|core|oblique/.test(primary)
  )
    return "core";
  if (
    /quad|glute|hamstring|calf|squat|lunge|deadlift|hip|leg/.test(blob) ||
    /quad|glute|hamstring|calf|leg/.test(primary)
  )
    return "strength_lower";
  if (
    /chest|back|shoulder|bicep|tricep|lat|delt|press|row|pull|push/.test(blob) ||
    /chest|back|shoulder|bicep|tricep|lat|delt/.test(primary)
  )
    return "strength_upper";
  return "strength_full";
}

function mapDifficulty(n) {
  const d = Number(n) || 5;
  if (d <= 3) return "beginner";
  if (d >= 8) return "advanced";
  return "intermediate";
}

function impactTags(ex) {
  const blob = `${ex.name} ${ex.description || ""}`.toLowerCase();
  const tags = ["open_exercisedb", "mit", "imported"];
  if (/jump|plyo|burpee|box.?jump|jumping.?jack|high.?knee|skip|hop/.test(blob)) {
    tags.push("jumping", "high_impact", "plyometric");
  } else {
    tags.push("low_impact");
  }
  const eq = (ex.equipment || []).map((e) => String(e).toLowerCase());
  if (eq.some((e) => /body|band|mat/.test(e))) tags.push("home");
  if (eq.some((e) => /machine|cable|barbell|smith/.test(e))) tags.push("gym");
  return [...new Set(tags)];
}

function parseSetsReps(raw) {
  const s = String(raw || "");
  const m = s.match(/(\d+)\s*[x×]\s*([0-9\-]+(?:\s*\w+)?)/i);
  if (m) {
    return {
      default_sets: Number(m[1]) || 3,
      default_reps: m[2].trim(),
    };
  }
  return { default_sets: 3, default_reps: "10-12" };
}

function loadCache() {
  if (!fs.existsSync(CACHE)) return {};
  return JSON.parse(fs.readFileSync(CACHE, "utf8"));
}

function saveCache(cache) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(cache));
}

async function translateEnToRu(text, cache) {
  const key = String(text || "").trim();
  if (!key) return "";
  if (cache[key]) return cache[key];
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ru&dt=t&q=" +
    encodeURIComponent(key);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const out = (j[0] || []).map((x) => x[0]).join("").trim();
      cache[key] = out || key;
      return cache[key];
    } catch {
      await sleep(400 * (attempt + 1));
    }
  }
  cache[key] = key;
  return key;
}

async function translateMany(items, cache, concurrency = 4) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const my = idx++;
      results[my] = await translateEnToRu(items[my], cache);
      await sleep(20);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () => worker()),
  );
  return results;
}

async function deleteEdb(url, key) {
  console.log("Deleting ExerciseDB imports (slug like edb-*)…");
  // PostgREST delete by filter; may need batches if many rows
  let deleted = 0;
  for (;;) {
    const list = await fetch(
      `${url}/rest/v1/exercises?select=id&slug=like.edb-*&limit=200`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      },
    ).then((r) => r.json());
    if (!Array.isArray(list) || list.length === 0) break;
    const ids = list.map((x) => x.id).join(",");
    const r = await fetch(`${url}/rest/v1/exercises?id=in.(${ids})`, {
      method: "DELETE",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: "return=minimal",
      },
    });
    if (!r.ok) throw new Error(`delete failed ${r.status} ${await r.text()}`);
    deleted += list.length;
    process.stdout.write(`\rdeleted ${deleted}`);
    await sleep(50);
  }
  console.log(`\ndeleted edb rows: ${deleted}`);
}

async function main() {
  const env = loadEnv();
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");

  await deleteEdb(url, key);

  console.log("Fetching Open ExerciseDB (MIT)…");
  const raw = await fetch(SOURCE).then((r) => {
    if (!r.ok) throw new Error(`fetch source ${r.status}`);
    return r.json();
  });
  const list = Array.isArray(raw) ? raw : raw.exercises || [];
  console.log("source exercises:", list.length);

  const cache = loadCache();
  const mapped = [];

  for (let i = 0; i < list.length; i++) {
    const ex = list[i];
    const nameEn = humanizeId(ex.name || ex.id);
    const tips = Array.isArray(ex.execution_tips) ? ex.execution_tips : [];
    const toTr = [nameEn, ex.description || "", ...tips].filter(Boolean);
    const tr = await translateMany(toTr, cache, 4);
    const nameRu = titleRu(tr[0]);
    const descRu = titleRu(tr[1] || "");
    const tipsRu = tr.slice(2).map(titleRu);

    const muscles = [
      ...new Set(
        [ex.primary_muscle, ...(ex.secondary_muscles || [])]
          .filter(Boolean)
          .map(ruMuscle),
      ),
    ];
    const equipment = mapEquipment(ex.equipment);
    const category = mapCategory(ex);
    const { default_sets, default_reps } = parseSetsReps(ex.typical_sets_reps);
    const eqRu = equipment
      .map((t) =>
        ({
          bodyweight: "свой вес",
          dumbbell: "гантели",
          barbell: "штанга",
          kettlebell: "гиря",
          band: "резинка",
          cable: "блок",
          machine: "тренажёр",
          medicine_ball: "медбол",
          stability_ball: "фитбол",
          bench: "скамья",
          mat: "коврик",
          other: "другое",
        })[t] || t,
      )
      .join(", ");

    const description = [
      descRu || `${nameRu} — упражнение для мышц: ${muscles.join(", ") || "основные группы"}.`,
      `Инвентарь: ${eqRu}.`,
      "Источник: Open ExerciseDB (MIT).",
    ].join(" ");

    mapped.push({
      slug: `oedb-${String(ex.id || ex.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.replace(
        /-+/g,
        "-",
      ),
      name: nameRu,
      category,
      muscle_groups: muscles.length ? muscles : ["всё тело"],
      equipment,
      difficulty: mapDifficulty(ex.difficulty),
      tags: impactTags(ex),
      description,
      cues: tipsRu.slice(0, 8),
      common_mistakes: [
        "Рывки и инерция вместо контроля",
        "Задержка дыхания",
        "Потеря нейтрального положения поясницы",
      ],
      gif_url: null,
      video_url: null,
      default_sets,
      default_reps,
      tempo: category.startsWith("strength") ? "2-0-2" : null,
      rest_seconds: category === "cardio" || category === "core" ? 45 : 60,
    });

    if ((i + 1) % 10 === 0 || i + 1 === list.length) {
      saveCache(cache);
      process.stdout.write(`\rmap+ru ${i + 1}/${list.length}`);
    }
  }
  console.log(`\nmapped ${mapped.length}`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DATA_DIR, "open-exercisedb-mapped.json"),
    JSON.stringify(mapped, null, 2),
  );

  let ok = 0;
  let fail = 0;
  const batchSize = 40;
  for (let i = 0; i < mapped.length; i += batchSize) {
    const batch = mapped.slice(i, i + batchSize);
    const r = await fetch(`${url}/rest/v1/exercises?on_conflict=slug`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(batch),
    });
    if (!r.ok) {
      fail += batch.length;
      console.error("\nupsert error", r.status, await r.text());
    } else {
      ok += batch.length;
    }
    process.stdout.write(`\rupsert ${Math.min(i + batch.length, mapped.length)}/${mapped.length}`);
    await sleep(60);
  }
  console.log(`\nupsert done ok=${ok} fail=${fail}`);

  const count = await fetch(`${url}/rest/v1/exercises?select=id`, {
    method: "HEAD",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "count=exact",
    },
  });
  console.log("exercises total:", count.headers.get("content-range"));
  console.log("Done. Source: Glowupp-app/open-exercisedb (MIT).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
