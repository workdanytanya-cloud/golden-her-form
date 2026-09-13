/**
 * Импорт упражнений из ExerciseDB (free V1) в public.exercises.
 *
 * Источник: https://oss.exercisedb.dev/api/v1/exercises
 * Документация: https://github.com/exercisedb/exercisedb-api
 *
 * ВАЖНО: бесплатный tier — non-commercial + attribution AscendAPI/ExerciseDB.
 * Для коммерческого PanovaPRO нужен платный план RapidAPI.
 *
 * Usage:
 *   node scripts/import-exercisedb.mjs              # fetch + translate + upsert
 *   node scripts/import-exercisedb.mjs --fetch-only
 *   node scripts/import-exercisedb.mjs --upsert-only
 *   node scripts/import-exercisedb.mjs --limit=100
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(__dirname, "data");
const RAW_PATH = path.join(DATA_DIR, "exercisedb-raw.json");
const MAPPED_PATH = path.join(DATA_DIR, "exercisedb-mapped.json");
const TRANSLATE_CACHE = path.join(DATA_DIR, "exercisedb-translate-cache.json");

const API = "https://oss.exercisedb.dev/api/v1/exercises";
const PAGE = 25;

const args = process.argv.slice(2);
const FETCH_ONLY = args.includes("--fetch-only");
const UPSERT_ONLY = args.includes("--upsert-only");
const LIMIT = Number((args.find((a) => a.startsWith("--limit=")) || "").split("=")[1] || 0) || 0;

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[line.slice(0, i).trim()] = v;
  }
  return env;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- RU maps (под генератор: muscleHint в training.ts) ----

const MUSCLE_RU = {
  abs: "пресс",
  "external obliques": "косые мышцы живота",
  "hip flexors": "сгибатели бедра",
  quads: "квадрицепс",
  quadriceps: "квадрицепс",
  glutes: "ягодицы",
  "gluteus maximus": "ягодицы",
  "gluteus medius": "средняя ягодичная",
  hamstrings: "задняя поверхность бедра",
  calves: "икры",
  "gastrocnemius": "икры",
  soleus: "икры",
  chest: "грудные",
  "pectoralis major": "грудные",
  "pectorals": "грудные",
  lats: "широчайшие",
  "latissimus dorsi": "широчайшие",
  back: "спина",
  spine: "спина",
  waist: "талия",
  traps: "трапеции",
  "upper back": "верх спины",
  "lower back": "низ спины",
  shoulders: "плечи",
  delts: "плечи",
  "deltoid anterior": "передние дельты",
  "deltoid lateral": "средние дельты",
  "deltoid posterior": "задние дельты",
  "rear deltoid": "задние дельты",
  biceps: "бицепс",
  triceps: "трицепс",
  forearms: "предплечья",
  adductors: "приводящие",
  abductors: "отводящие",
  "serratus anterior": "зубчатая",
  cardiovascular: "кардио",
  "cardiovascular system": "кардио",
};

const EQUIP_EN_TO_TAG = {
  "body weight": "bodyweight",
  bodyweight: "bodyweight",
  dumbbell: "dumbbell",
  barbell: "barbell",
  kettlebell: "kettlebell",
  band: "band",
  "resistance band": "band",
  cable: "cable",
  "leverage machine": "machine",
  "smith machine": "machine",
  assisted: "machine",
  "ez barbell": "barbell",
  "olympic barbell": "barbell",
  "medicine ball": "medicine_ball",
  "stability ball": "stability_ball",
  "exercise ball": "stability_ball",
  bosu: "bosu",
  "bosu ball": "bosu",
  rope: "rope",
  "wheel roller": "ab_wheel",
  "ab wheel": "ab_wheel",
  sled: "sled",
  "trap bar": "barbell",
  weighted: "other",
  tire: "other",
  hammer: "other",
  "skierg machine": "cardio_machine",
  "elliptical machine": "cardio_machine",
  "stationary bike": "cardio_machine",
  "stepmill machine": "cardio_machine",
  "indoor rowing machine": "cardio_machine",
  "upper body ergometer": "cardio_machine",
};

const EQUIP_TAG_RU = {
  bodyweight: "свой вес",
  dumbbell: "гантели",
  barbell: "штанга",
  kettlebell: "гиря",
  band: "резинка",
  cable: "блок/канат",
  machine: "тренажёр",
  medicine_ball: "медбол",
  stability_ball: "фитбол",
  bosu: "босу",
  rope: "канат",
  ab_wheel: "ролик",
  sled: "сани",
  cardio_machine: "кардио-тренажёр",
  other: "другое",
  mat: "коврик",
};

function ruMuscle(en) {
  const k = String(en || "").toLowerCase().trim();
  if (MUSCLE_RU[k]) return MUSCLE_RU[k];
  for (const [a, b] of Object.entries(MUSCLE_RU)) {
    if (k.includes(a)) return b;
  }
  return k || "всё тело";
}

function mapEquipment(list) {
  const tags = new Set();
  for (const raw of list || []) {
    const k = String(raw).toLowerCase().trim();
    tags.add(EQUIP_EN_TO_TAG[k] || "other");
  }
  if (tags.size === 0) tags.add("bodyweight");
  if ([...tags].some((t) => ["bodyweight", "band", "mat"].includes(t))) tags.add("mat");
  return [...tags];
}

function mapCategory(ex) {
  const name = `${ex.name} ${(ex.bodyParts || []).join(" ")} ${(ex.targetMuscles || []).join(" ")}`.toLowerCase();
  const body = (ex.bodyParts || []).map((b) => b.toLowerCase());
  const targets = (ex.targetMuscles || []).map((t) => t.toLowerCase());

  if (
    /stretch|yoga|pose|mobility|foam roll|child|pigeon|cat.?cow|world.?s greatest|couch stretch|hamstring stretch|quad stretch|hip circle|dislocate|facing dog|downward dog|cobra|bridge pose|warrior|namaste|prayer/.test(
      name,
    ) ||
    targets.includes("spine")
  ) {
    if (/cool|recover|relax|hold pose|static/.test(name)) return "cooldown";
    return "mobility";
  }
  if (
    body.includes("cardio") ||
    targets.some((t) => t.includes("cardiovascular")) ||
    /jump|burpee|mountain.?climb|jumping.?jack|high.?knee|sprint|run|skip|cardio|battle.?rope/.test(
      name,
    )
  ) {
    return "cardio";
  }
  if (
    body.includes("waist") ||
    targets.some((t) => /abs|oblique|core/.test(t)) ||
    /plank|crunch|dead.?bug|hollow|russian.?twist|leg.?raise|ab /i.test(name)
  ) {
    return "core";
  }
  if (
    body.some((b) => ["upper legs", "lower legs", "glutes"].includes(b)) ||
    targets.some((t) =>
      /quad|glute|hamstring|calf|adductor|abductor|hip/.test(t),
    ) ||
    /squat|lunge|deadlift|hip.?thrust|glute|leg.?press|calf|step.?up|rdl/.test(name)
  ) {
    return "strength_lower";
  }
  if (
    body.some((b) =>
      ["chest", "back", "shoulders", "upper arms", "lower arms", "neck"].includes(b),
    ) ||
    targets.some((t) =>
      /pectoral|lat|delt|bicep|tricep|trap|shoulder|chest|back|forearm/.test(t),
    )
  ) {
    return "strength_upper";
  }
  return "strength_full";
}

function mapDifficulty(ex) {
  const name = String(ex.name || "").toLowerCase();
  if (/assisted|knee|beginner|wall|incline push/.test(name)) return "beginner";
  if (/pistol|muscle.?up|handstand|advanced|olymp|snatch|clean/.test(name)) return "advanced";
  const eq = (ex.equipments || []).map((e) => e.toLowerCase());
  if (eq.every((e) => e === "body weight" || e === "band" || e === "resistance band")) {
    return "beginner";
  }
  return "intermediate";
}

function impactTags(ex) {
  const name = String(ex.name || "").toLowerCase();
  const tags = ["exercisedb", "imported"];
  if (/jump|plyo|burpee|box.?jump|jumping.?jack|high.?knee|skip|hop/.test(name)) {
    tags.push("jumping", "high_impact", "plyometric");
  }
  if (/stretch|yoga|isometric|plank|wall.?sit|hold/.test(name)) tags.push("low_impact");
  if ((ex.equipments || []).some((e) => /body weight|band/i.test(e))) tags.push("home");
  if ((ex.equipments || []).some((e) => /machine|cable|barbell|smith/i.test(e))) tags.push("gym");
  return [...new Set(tags)];
}

function defaultsForCategory(category) {
  switch (category) {
    case "warmup":
    case "mobility":
      return { default_sets: 1, default_reps: "8-12", rest_seconds: 20, tempo: null };
    case "activation":
      return { default_sets: 2, default_reps: "12-15", rest_seconds: 30, tempo: null };
    case "cooldown":
      return { default_sets: 1, default_reps: "40 сек", rest_seconds: 15, tempo: null };
    case "cardio":
      return { default_sets: 1, default_reps: "40 сек", rest_seconds: 40, tempo: null };
    case "core":
      return { default_sets: 3, default_reps: "12-15", rest_seconds: 45, tempo: null };
    default:
      return { default_sets: 3, default_reps: "10-12", rest_seconds: 60, tempo: "2-0-2" };
  }
}

function cleanInstruction(s) {
  return String(s || "")
    .replace(/^Step:\s*\d+\s*/i, "")
    .replace(/^\d+[\).\:\-]\s*/, "")
    .trim();
}

function titleRu(s) {
  const t = String(s || "").trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function slugify(id, name) {
  const base = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `edb-${id}-${base || "move"}`.replace(/-+/g, "-");
}

// ---- translate ----

function loadTranslateCache() {
  if (!fs.existsSync(TRANSLATE_CACHE)) return {};
  return JSON.parse(fs.readFileSync(TRANSLATE_CACHE, "utf8"));
}

function saveTranslateCache(cache) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TRANSLATE_CACHE, JSON.stringify(cache, null, 0));
}

async function translateEnToRu(text, cache) {
  const key = text.trim();
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
    } catch (e) {
      await sleep(400 * (attempt + 1));
    }
  }
  cache[key] = key;
  return key;
}

async function fetchAll() {
  const all = [];
  let after = null;
  // Resume from partial raw if previous run hit rate limit
  if (fs.existsSync(RAW_PATH) && args.includes("--resume-fetch")) {
    const prev = JSON.parse(fs.readFileSync(RAW_PATH, "utf8"));
    all.push(...prev);
    after = prev.at(-1)?.exerciseId || null;
    console.log("resume fetch from", all.length, "after", after);
  }

  for (;;) {
    const qs = new URLSearchParams({ limit: String(PAGE) });
    if (after) qs.set("after", after);
    let j = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const r = await fetch(`${API}?${qs}`);
      if (r.status === 429) {
        const wait = 1500 * (attempt + 1);
        console.log(`\nrate limit, wait ${wait}ms`);
        await sleep(wait);
        continue;
      }
      if (!r.ok) throw new Error(`ExerciseDB fetch failed: ${r.status}`);
      j = await r.json();
      break;
    }
    if (!j) throw new Error("ExerciseDB fetch failed after retries");
    const chunk = j.data || [];
    // Avoid duplicates when resuming
    const seen = new Set(all.map((x) => x.exerciseId));
    for (const item of chunk) {
      if (!seen.has(item.exerciseId)) all.push(item);
    }
    process.stdout.write(`\rfetch ${all.length}/${j.meta?.total ?? "?"}`);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(RAW_PATH, JSON.stringify(all, null, 2));
    if (LIMIT && all.length >= LIMIT) {
      all.length = LIMIT;
      break;
    }
    if (!j.meta?.hasNextPage || !j.meta?.nextCursor) break;
    after = j.meta.nextCursor;
    await sleep(350);
  }
  console.log("\nfetched", all.length);
  return all;
}

async function mapAndTranslate(rawList) {
  const cache = loadTranslateCache();
  const out = [];
  const CONCURRENCY = 4;

  async function translateList(items) {
    const results = new Array(items.length);
    let idx = 0;
    async function worker() {
      while (idx < items.length) {
        const my = idx++;
        results[my] = await translateEnToRu(items[my], cache);
        await sleep(25);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => worker()));
    return results;
  }

  for (let i = 0; i < rawList.length; i++) {
    const ex = rawList[i];
    const category = mapCategory(ex);
    const equipment = mapEquipment(ex.equipments);
    const muscles = [
      ...new Set(
        [...(ex.targetMuscles || []), ...(ex.secondaryMuscles || [])].map(ruMuscle),
      ),
    ];
    const bodyRu = (ex.bodyParts || []).map(ruMuscle);
    const stepsEn = (ex.instructions || []).map(cleanInstruction).filter(Boolean);
    const [nameRuRaw, ...stepsRu] = await translateList([ex.name, ...stepsEn]);
    const nameRu = titleRu(nameRuRaw);

    const eqRu = equipment.map((t) => EQUIP_TAG_RU[t] || t).join(", ");
    const focus = [...new Set([...muscles, ...bodyRu])].filter(Boolean).join(", ");
    const description = [
      `${nameRu} — упражнение для мышц: ${focus || "основные группы"}.`,
      `Инвентарь: ${eqRu}.`,
      "Выполняйте в контролируемом темпе, без рывков; при дискомфорте в суставах уменьшите амплитуду или замените движение.",
    ].join(" ");

    const defs = defaultsForCategory(category);
    out.push({
      slug: slugify(ex.exerciseId, ex.name),
      name: nameRu,
      category,
      muscle_groups: muscles.length ? muscles : bodyRu.length ? bodyRu : ["всё тело"],
      equipment,
      difficulty: mapDifficulty(ex),
      tags: impactTags(ex),
      description,
      cues: stepsRu.slice(0, 6),
      common_mistakes: [
        "Рывки и инерция вместо контроля мышц",
        "Задержка дыхания",
        "Потеря нейтрального положения поясницы",
      ],
      gif_url: ex.gifUrl || null,
      video_url: null,
      ...defs,
      _source_id: ex.exerciseId,
      _source_name_en: ex.name,
    });

    if ((i + 1) % 10 === 0 || i + 1 === rawList.length) {
      saveTranslateCache(cache);
      process.stdout.write(`\rmap+ru ${i + 1}/${rawList.length}`);
    }
  }
  console.log(`\nmapped ${out.length}`);
  fs.writeFileSync(MAPPED_PATH, JSON.stringify(out, null, 2));
  return out;
}

async function upsert(mapped) {
  const env = loadEnv();
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env");

  // Не трогаем «родные» упражнения сайта (без префикса edb-)
  let ok = 0;
  let fail = 0;
  const batchSize = 40;
  for (let i = 0; i < mapped.length; i += batchSize) {
    const batch = mapped.slice(i, i + batchSize).map((row) => {
      const {
        _source_id,
        _source_name_en,
        ...rest
      } = row;
      return rest;
    });
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
    await sleep(80);
  }
  console.log(`\nupsert done ok=${ok} fail=${fail}`);
}

async function main() {
  console.log("ExerciseDB → PanovaPRO import");
  console.log(
    "License note: free tier is non-commercial; commercial use needs RapidAPI paid plan.",
  );

  let raw;
  if (UPSERT_ONLY) {
    if (!fs.existsSync(MAPPED_PATH)) throw new Error("Нет mapped файла — сначала полный прогон");
    const mapped = JSON.parse(fs.readFileSync(MAPPED_PATH, "utf8"));
    await upsert(mapped);
    return;
  }

  if (fs.existsSync(RAW_PATH) && !args.includes("--refetch")) {
    raw = JSON.parse(fs.readFileSync(RAW_PATH, "utf8"));
    console.log("raw cache", raw.length);
    if (LIMIT) raw = raw.slice(0, LIMIT);
  } else {
    raw = await fetchAll();
  }

  if (FETCH_ONLY) return;

  const mapped = await mapAndTranslate(raw);
  await upsert(mapped);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
