/**
 * Upload local MFR workout video and upsert exercise row.
 * node --env-file=.env scripts/upload-mfr-exercise.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const localFile = path.join(__dirname, "_video_downloads", "mfr-1.mp4");
const slug = "mfr-1";
const storagePath = `exercises/videos/${slug}.mp4`;

function loadEnv() {
  const raw = fs.readFileSync(path.join(root, ".env"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[line.slice(0, i).trim()] = v;
  }
  return env;
}

const env = loadEnv();
const supabaseUrl = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!fs.existsSync(localFile)) {
  console.error("Missing file:", localFile);
  process.exit(1);
}

const h = {
  apikey: key,
  Authorization: `Bearer ${key}`,
};

async function upload() {
  const bytes = fs.readFileSync(localFile);
  console.log(`Uploading ${(bytes.length / (1024 * 1024)).toFixed(1)} MB → ${storagePath}`);
  const r = await fetch(`${supabaseUrl}/storage/v1/object/media/${storagePath}`, {
    method: "POST",
    headers: {
      ...h,
      "Content-Type": "video/mp4",
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!r.ok) {
    throw new Error(`upload ${r.status}: ${await r.text()}`);
  }
  console.log("upload ok");
  return `${supabaseUrl}/storage/v1/object/public/media/${storagePath}`;
}

async function upsertExercise(videoUrl) {
  const payload = {
    slug,
    name: "МФР: комплекс 1",
    category: "mobility",
    muscle_groups: ["спина", "ягодицы", "бёдра", "голени"],
    equipment: ["ролл для МФР"],
    difficulty: "beginner",
    tags: ["home", "mfr", "recovery", "mobility", "cooldown"],
    description:
      "Миофасциальный релиз (МФР) — мягкая работа с роллом для снятия напряжения в мышцах и фасциях. Комплекс подходит после силовой тренировки или в день восстановления: спина, ягодицы, бёдра и голени. Дышите спокойно, не задерживайте дыхание; давление — комфортное, без резкой боли. Если есть острая травма или сильный дискомфорт — пропустите зону и обратитесь к тренеру.",
    cues: [
      "Медленно прокатывайте зону 30–60 секунд",
      "На болезненных точках задержитесь на 10–20 секунд и дышите",
      "Давление мягкое: 4–6 из 10 по ощущениям",
      "Тело расслаблено, без задержки дыхания",
    ],
    common_mistakes: [
      "Слишком сильное давление и «пробивание» через боль",
      "Быстрое катание без остановки на триггерных точках",
      "Работа на кости / суставе вместо мышцы",
    ],
    gif_url: null,
    video_url: videoUrl,
    default_sets: 1,
    default_reps: "20-25 мин",
    tempo: null,
    rest_seconds: 0,
  };

  const existing = await fetch(
    `${supabaseUrl}/rest/v1/exercises?slug=eq.${slug}&select=id`,
    { headers: { ...h, "Content-Type": "application/json" } },
  ).then((r) => r.json());

  if (Array.isArray(existing) && existing[0]?.id) {
    const id = existing[0].id;
    const patch = await fetch(`${supabaseUrl}/rest/v1/exercises?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...h, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
    const text = await patch.text();
    if (!patch.ok) throw new Error(`patch ${patch.status}: ${text}`);
    console.log("exercise updated", id);
    return JSON.parse(text)[0];
  }

  const ins = await fetch(`${supabaseUrl}/rest/v1/exercises`, {
    method: "POST",
    headers: { ...h, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  const text = await ins.text();
  if (!ins.ok) throw new Error(`insert ${ins.status}: ${text}`);
  const row = JSON.parse(text)[0];
  console.log("exercise created", row.id);
  return row;
}

async function verify(url) {
  const head = await fetch(url, { method: "HEAD" });
  console.log("HEAD", head.status, "content-type=", head.headers.get("content-type"), "accept-ranges=", head.headers.get("accept-ranges"), "len=", head.headers.get("content-length"));

  const range = await fetch(url, {
    headers: { Range: "bytes=0-1023" },
  });
  console.log("Range", range.status, "content-range=", range.headers.get("content-range"), "bytes=", (await range.arrayBuffer()).byteLength);

  const get = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    },
  });
  // Don't download full body — abort after headers via redirect/check
  console.log("GET mobile UA", get.status, "type=", get.headers.get("content-type"), "len=", get.headers.get("content-length"));
  // Cancel body consumption for large file — we already have status
  try {
    await get.body?.cancel?.();
  } catch {}

  const android = await fetch(url, {
    method: "HEAD",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    },
  });
  console.log("HEAD android UA", android.status);

  if (!head.ok || range.status !== 206) {
    throw new Error("Playback checks failed (need 200 HEAD and 206 Range for mobile <video>)");
  }
  console.log("✓ Video is publicly playable with Range support");
}

const videoUrl = await upload();
const row = await upsertExercise(videoUrl);
console.log({
  id: row.id,
  slug: row.slug,
  name: row.name,
  video_url: row.video_url,
});
await verify(videoUrl);
