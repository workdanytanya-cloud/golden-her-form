/**
 * Импорт упражнений из hasaneyldrm/exercises-dataset (текст + RU, БЕЗ GIF).
 *
 * Источник: https://github.com/hasaneyldrm/exercises-dataset
 * - Текст / инструкции / переводы: MIT — коммерция OK
 * - GIF/картинки Gym visual: НЕ импортируем (нужна отдельная лицензия)
 *
 * Удаляет прошлые импорты: slug like edb-* / oedb-*
 * Свои упражнения тренера (без этих префиксов) не трогает.
 *
 *   node scripts/import-logpress-text.mjs
 *   node scripts/import-logpress-text.mjs --limit=50
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(__dirname, "data");
const SOURCE =
  "https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main/data/exercises.json";
const NAME_CACHE = path.join(DATA_DIR, "logpress-name-ru-cache.json");

const args = process.argv.slice(2);
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

function slugify(id, name) {
  const base = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `lp-${id}-${base || "move"}`.replace(/-+/g, "-");
}

const MUSCLE_RU = {
  abs: "пресс",
  waist: "талия",
  shoulders: "плечи",
  chest: "грудные",
  back: "спина",
  lats: "широчайшие",
  traps: "трапеции",
  quads: "квадрицепс",
  quadriceps: "квадрицепс",
  glutes: "ягодицы",
  hamstrings: "задняя поверхность бедра",
  calves: "икры",
  biceps: "бицепс",
  triceps: "трицепс",
  forearms: "предплечья",
  "upper arms": "руки",
  "lower arms": "предплечья",
  "upper legs": "ноги",
  "lower legs": "голени",
  cardio: "кардио",
  neck: "шея",
  spine: "спина",
  adductors: "приводящие",
  abductors: "отводящие",
  "hip flexors": "сгибатели бедра",
  "serratus anterior": "зубчатая",
  "pectoralis major": "грудные",
  "deltoids": "плечи",
  "anterior deltoid": "передние дельты",
  "posterior deltoid": "задние дельты",
  "lateral deltoid": "средние дельты",
  "erector spinae": "разгибатели спины",
  "latissimus dorsi": "широчайшие",
  cardiovascular: "кардио",
  "cardiovascular system": "кардио",
};

function ruMuscle(en) {
  const k = String(en || "").toLowerCase().trim();
  if (!k) return null;
  if (MUSCLE_RU[k]) return MUSCLE_RU[k];
  for (const [a, b] of Object.entries(MUSCLE_RU)) {
    if (k.includes(a)) return b;
  }
  return k;
}

const EQUIP_MAP = {
  "body weight": "bodyweight",
  bodyweight: "bodyweight",
  cable: "cable",
  "leverage machine": "machine",
  assisted: "machine",
  "medicine ball": "medicine_ball",
  "stability ball": "stability_ball",
  band: "band",
  "resistance band": "band",
  barbell: "barbell",
  "ez barbell": "barbell",
  "olympic barbell": "barbell",
  "trap bar": "barbell",
  rope: "rope",
  dumbbell: "dumbbell",
  "sled machine": "sled",
  "upper body ergometer": "cardio_machine",
  kettlebell: "kettlebell",
  weighted: "other",
  "bosu ball": "bosu",
  roller: "ab_wheel",
  "wheel roller": "ab_wheel",
  "skierg machine": "cardio_machine",
  hammer: "other",
  "smith machine": "machine",
  "stationary bike": "cardio_machine",
  tire: "other",
  "elliptical machine": "cardio_machine",
  "stepmill machine": "cardio_machine",
};

function mapEquipment(raw) {
  const k = String(raw || "").toLowerCase().trim();
  const tags = new Set([EQUIP_MAP[k] || "other"]);
  if ([...tags].some((t) => ["bodyweight", "band", "mat"].includes(t))) tags.add("mat");
  return [...tags];
}

function mapCategory(ex) {
  const name = String(ex.name || "").toLowerCase();
  const body = String(ex.body_part || ex.category || "").toLowerCase();
  const target = String(ex.target || "").toLowerCase();
  const muscle = String(ex.muscle_group || "").toLowerCase();
  const blob = `${name} ${body} ${target} ${muscle}`;

  if (/stretch|yoga|foam|mobility|cat.?cow|child|pigeon|facing dog/.test(blob)) {
    return /cool|recover|static hold/.test(blob) ? "cooldown" : "mobility";
  }
  if (body === "cardio" || target.includes("cardiovascular") || /burpee|jump|skip|sprint|run|hiit/.test(name)) {
    return "cardio";
  }
  if (
    body === "waist" ||
    /abs|oblique|core|plank|crunch|dead.?bug|hollow|twist|sit.?up|leg raise/.test(blob)
  ) {
    return "core";
  }
  if (
    ["upper legs", "lower legs"].includes(body) ||
    /quad|glute|hamstring|calf|squat|lunge|deadlift|hip.?thrust|leg.?press|step.?up|rdl/.test(blob)
  ) {
    return "strength_lower";
  }
  if (
    ["chest", "back", "shoulders", "upper arms", "lower arms", "neck"].includes(body) ||
    /press|row|pull|push|curl|fly|lat|delt|bicep|tricep|chest|shoulder/.test(blob)
  ) {
    return "strength_upper";
  }
  return "strength_full";
}

function mapDifficulty(ex) {
  const name = String(ex.name || "").toLowerCase();
  const eq = String(ex.equipment || "").toLowerCase();
  if (/assisted|knee|beginner|wall/.test(name) || eq === "body weight" || eq.includes("band")) {
    return "beginner";
  }
  if (/pistol|muscle.?up|handstand|snatch|clean|advanced/.test(name)) return "advanced";
  return "intermediate";
}

function impactTags(ex) {
  const name = String(ex.name || "").toLowerCase();
  const tags = ["logpress", "mit", "imported"];
  if (/jump|plyo|burpee|box.?jump|jumping.?jack|high.?knee|skip|hop/.test(name)) {
    tags.push("jumping", "high_impact", "plyometric");
  } else {
    tags.push("low_impact");
  }
  const eq = String(ex.equipment || "").toLowerCase();
  if (/body weight|band/.test(eq)) tags.push("home");
  if (/machine|cable|barbell|smith/.test(eq)) tags.push("gym");
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

function loadCache() {
  if (!fs.existsSync(NAME_CACHE)) return {};
  return JSON.parse(fs.readFileSync(NAME_CACHE, "utf8"));
}

function saveCache(cache) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(NAME_CACHE, JSON.stringify(cache));
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

async function deleteByPrefix(url, key, prefix) {
  console.log(`Deleting imports slug like ${prefix}* …`);
  let deleted = 0;
  for (;;) {
    const list = await fetch(
      `${url}/rest/v1/exercises?select=id&slug=like.${prefix}*&limit=200`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
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
    if (!r.ok) throw new Error(`delete ${prefix} failed ${r.status} ${await r.text()}`);
    deleted += list.length;
    process.stdout.write(`\rdeleted ${prefix} ${deleted}`);
    await sleep(40);
  }
  console.log(`\ndeleted ${prefix}: ${deleted}`);
}

async function main() {
  const env = loadEnv();
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");

  await deleteByPrefix(url, key, "edb-");
  await deleteByPrefix(url, key, "oedb-");
  await deleteByPrefix(url, key, "lp-");

  console.log("Fetching LogPress/exercises-dataset…");
  const raw = await fetch(SOURCE).then(async (r) => {
    if (!r.ok) throw new Error(`source fetch ${r.status}`);
    return r.json();
  });
  let list = Array.isArray(raw) ? raw : [];
  if (LIMIT) list = list.slice(0, LIMIT);
  console.log("source exercises:", list.length);

  const cache = loadCache();
  const mapped = [];
  const EQUIP_RU = {
    bodyweight: "свой вес",
    dumbbell: "гантели",
    barbell: "штанга",
    kettlebell: "гиря",
    band: "резинка",
    cable: "блок",
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

  for (let i = 0; i < list.length; i++) {
    const ex = list[i];
    const nameRu = titleRu(await translateEnToRu(ex.name, cache));
    const stepsRu = Array.isArray(ex.instruction_steps?.ru)
      ? ex.instruction_steps.ru.filter(Boolean)
      : [];
    const textRu =
      (typeof ex.instructions?.ru === "string" && ex.instructions.ru.trim()) ||
      stepsRu.join(" ");

    const muscles = [
      ...new Set(
        [ex.target, ex.muscle_group, ...(ex.secondary_muscles || [])]
          .map(ruMuscle)
          .filter(Boolean),
      ),
    ];
    const equipment = mapEquipment(ex.equipment);
    const category = mapCategory(ex);
    const defs = defaultsForCategory(category);
    const eqRu = equipment.map((t) => EQUIP_RU[t] || t).join(", ");
    const focus = muscles.join(", ") || "основные группы";

    const description = [
      textRu || `${nameRu} — упражнение для мышц: ${focus}.`,
      `Инвентарь: ${eqRu}.`,
      "Источник данных: exercises-dataset (MIT). Медиа Gym visual не используются.",
    ].join(" ");

    mapped.push({
      slug: slugify(ex.id, ex.name),
      name: nameRu,
      category,
      muscle_groups: muscles.length ? muscles : ["всё тело"],
      equipment,
      difficulty: mapDifficulty(ex),
      tags: impactTags(ex),
      description,
      cues: (stepsRu.length ? stepsRu : textRu ? [textRu] : []).slice(0, 8),
      common_mistakes: [
        "Рывки и инерция вместо контроля",
        "Задержка дыхания",
        "Потеря нейтрального положения поясницы",
      ],
      gif_url: null,
      video_url: null,
      ...defs,
    });

    if ((i + 1) % 25 === 0 || i + 1 === list.length) {
      saveCache(cache);
      process.stdout.write(`\rmap+ru ${i + 1}/${list.length}`);
    }
  }
  console.log(`\nmapped ${mapped.length}`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, "logpress-mapped.json"), JSON.stringify(mapped, null, 2));

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
    await sleep(50);
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
  console.log("Done. Text-only MIT import from hasaneyldrm/exercises-dataset.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
