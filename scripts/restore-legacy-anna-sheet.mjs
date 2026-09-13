/**
 * Восстановить упражнения из старой таблицы (Rutube):
 * https://docs.google.com/spreadsheets/d/13tuqIgdPAP3U7PfMakse3hIvZkBCwSbNjJIaUeYmahQ
 *
 * Не перезаписывает panova — при конфликте slug создаёт legacy-*.
 * node --env-file=.env scripts/restore-legacy-anna-sheet.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getVideoEmbedUrl,
  parseExercisesFromCsv,
} from "./exercises-sheet.lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const SHEET_ID = "13tuqIgdPAP3U7PfMakse3hIvZkBCwSbNjJIaUeYmahQ";
const csvPath = path.join(__dirname, "_sheet_tabs", "legacy-anna-sheet.csv");

function loadEnv() {
  const raw = fs.readFileSync(path.join(root, ".env"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
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

const env = loadEnv();
const supabaseUrl = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(
  /\/$/,
  "",
);
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const h = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  Prefer: "resolution=merge-duplicates,return=representation",
};

if (!fs.existsSync(csvPath) || fs.statSync(csvPath).size < 100) {
  const exportUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`;
  const res = await fetch(exportUrl);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  fs.writeFileSync(csvPath, Buffer.from(await res.arrayBuffer()));
}

const text = fs.readFileSync(csvPath, "utf8");
const parsed = parseExercisesFromCsv(text);
console.log(`Parsed unique exercises: ${parsed.length}`);

const existing = await fetch(
  `${supabaseUrl}/rest/v1/exercises?select=id,slug,name,video_url,tags&limit=5000`,
  { headers: h },
).then((r) => r.json());

const bySlug = new Map(existing.map((e) => [e.slug, e]));
const byVideo = new Map(
  existing.filter((e) => e.video_url).map((e) => [e.video_url.toLowerCase(), e]),
);

const toUpsert = [];
for (const ex of parsed) {
  const embed = getVideoEmbedUrl(ex.video_url);
  if (!embed) {
    console.warn(`✗ no embed: ${ex.name} → ${ex.video_url}`);
  }

  const sameVid = byVideo.get((ex.video_url || "").toLowerCase());
  if (sameVid) {
    // Ensure legacy-coach tag so dedupe won't wipe it
    const tags = new Set([...(sameVid.tags || []), "sheet", "legacy-coach", "anna-sheet"]);
    const needsTag =
      !(sameVid.tags || []).includes("legacy-coach") ||
      !(sameVid.tags || []).includes("anna-sheet");
    if (needsTag) {
      toUpsert.push({
        slug: sameVid.slug,
        name: sameVid.name,
        category: "strength_full",
        muscle_groups: ["всё тело"],
        equipment: ["mat"],
        difficulty: "beginner",
        tags: [...tags],
        description: sameVid.name,
        cues: ["Смотрите технику на видео тренера"],
        common_mistakes: ["Спешка и потеря контроля"],
        video_url: sameVid.video_url,
        default_sets: 1,
        default_reps: "по видео",
        tempo: null,
        rest_seconds: 30,
      });
      // Will merge on slug — but we need full row. Better PATCH tags only.
    }
    console.log(`= already in DB: ${sameVid.slug} (${ex.name})`);
    continue;
  }

  let slug = ex.slug;
  const clash = bySlug.get(slug);
  if (clash && (clash.tags || []).includes("panova")) {
    slug = `legacy-${slug}`;
  }

  toUpsert.push({
    slug,
    name: ex.name,
    category: ex.category,
    muscle_groups: ex.muscle_groups,
    equipment: ex.equipment,
    difficulty: ex.difficulty,
    tags: [...new Set([...(ex.tags || []), "sheet", "legacy-coach", "anna-sheet"])],
    description: ex.description,
    cues: ex.cues,
    common_mistakes: ex.common_mistakes,
    video_url: ex.video_url,
    default_sets: ex.default_sets,
    default_reps: ex.default_reps,
    tempo: null,
    rest_seconds: ex.rest_seconds,
  });
}

console.log(`\nUpsert rows: ${toUpsert.length}`);
for (const e of toUpsert) console.log(`  + ${e.slug} | ${e.name}`);

if (toUpsert.length) {
  // Prefer insert of missing only — avoid clobbering panova fields via incomplete rows
  const insertRows = toUpsert.filter((e) => !bySlug.has(e.slug));
  const patchTags = toUpsert.filter((e) => bySlug.has(e.slug));

  if (insertRows.length) {
    const res = await fetch(`${supabaseUrl}/rest/v1/exercises`, {
      method: "POST",
      headers: { ...h, Prefer: "return=representation" },
      body: JSON.stringify(insertRows),
    });
    if (!res.ok) {
      console.error("INSERT failed:", res.status, (await res.text()).slice(0, 600));
      process.exit(1);
    }
    console.log(`✓ Inserted ${insertRows.length}`);
  }

  for (const e of patchTags) {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/exercises?slug=eq.${encodeURIComponent(e.slug)}`,
      {
        method: "PATCH",
        headers: { ...h, Prefer: "return=minimal" },
        body: JSON.stringify({ tags: e.tags }),
      },
    );
    if (!res.ok) {
      console.error("PATCH tags failed:", e.slug, await res.text());
      process.exit(1);
    }
  }
  if (patchTags.length) console.log(`✓ Tagged ${patchTags.length} existing`);
}

// Verify all anna-sheet / newly related videos
const check = await fetch(
  `${supabaseUrl}/rest/v1/exercises?select=slug,name,video_url,tags&or=(tags.cs.{anna-sheet},tags.cs.{legacy-coach})&order=slug`,
  { headers: h },
).then((r) => r.json());

console.log(`\n=== Verify ${check.length} legacy/anna exercises ===`);
let ok = 0;
let fail = 0;
for (const e of check) {
  const embed = getVideoEmbedUrl(e.video_url || "");
  if (!embed) {
    console.log(`✗ ${e.slug}: no embed`);
    fail++;
    continue;
  }
  try {
    const r = await fetch(embed, { method: "HEAD", redirect: "follow" });
    if (r.ok || r.status === 405 || r.status === 200) {
      console.log(`✓ ${e.slug}: ${r.status}`);
      ok++;
    } else {
      // Rutube often returns 200 on GET only
      const g = await fetch(embed, { method: "GET", redirect: "follow" });
      if (g.ok) {
        console.log(`✓ ${e.slug}: GET ${g.status}`);
        ok++;
      } else {
        console.log(`✗ ${e.slug}: HTTP ${r.status}/${g.status}`);
        fail++;
      }
    }
  } catch (err) {
    console.log(`✗ ${e.slug}: ${err.message}`);
    fail++;
  }
}
console.log(`\nDone: ${ok} playable embeds, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
