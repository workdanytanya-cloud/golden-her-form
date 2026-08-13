/**
 * Скачивает YouTube-видео panova-упражнений и заливает mp4 в Supabase Storage.
 * Обновляет exercises.video_url на signed URL (10 лет).
 * Оригиналы сохраняются в scripts/_video_mirror_map.json
 *
 * Нужен yt-dlp (+ ffmpeg). На машине загрузки может понадобиться VPN.
 *
 * node --env-file=.env scripts/mirror-youtube-to-storage.mjs [--limit=2] [--dry-run] [--slug=sheet-xxx]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const tmpDir = path.join(__dirname, "_video_downloads");
const mapPath = path.join(__dirname, "_video_mirror_map.json");
const TEN_YEARS = 60 * 60 * 24 * 365 * 10;

const dryRun = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 0;
const slugArg = process.argv.find((a) => a.startsWith("--slug="));
const onlySlug = slugArg ? slugArg.split("=")[1] : null;

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
    ) {
      v = v.slice(1, -1);
    }
    env[line.slice(0, i).trim()] = v;
  }
  return env;
}

function findYtDlp() {
  const candidates = [
    "yt-dlp",
    path.join(
      process.env.LOCALAPPDATA || "",
      "Microsoft\\WinGet\\Packages\\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\\yt-dlp.exe",
    ),
    path.join(
      process.env.APPDATA || "",
      "Python\\Python314\\Scripts\\yt-dlp.exe",
    ),
  ];
  for (const c of candidates) {
    if (c === "yt-dlp") {
      const r = spawnSync(c, ["--version"], { encoding: "utf8" });
      if (r.status === 0) return c;
      continue;
    }
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function isYoutube(url) {
  return /youtu\.?be|youtube\.com/i.test(url || "");
}

function isHostedMp4(url) {
  if (!url) return false;
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) return true;
  if (/\/storage\/v1\/object\//i.test(url)) return true;
  return false;
}

const env = loadEnv();
const supabaseUrl = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !key) {
  console.error("Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const h = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

const ytDlp = findYtDlp();
if (!ytDlp) {
  console.error("yt-dlp не найден. Установите: winget install yt-dlp.yt-dlp");
  process.exit(1);
}
console.log("yt-dlp:", ytDlp);

const exercises = [];
let offset = 0;
while (true) {
  const chunk = await fetch(
    `${supabaseUrl}/rest/v1/exercises?select=id,slug,name,video_url,tags&tags=cs.{panova}&order=slug&offset=${offset}&limit=1000`,
    { headers: h },
  ).then((r) => r.json());
  if (!Array.isArray(chunk) || !chunk.length) break;
  exercises.push(...chunk);
  offset += chunk.length;
  if (chunk.length < 1000) break;
}

let queue = exercises.filter((e) => isYoutube(e.video_url) && !isHostedMp4(e.video_url));
if (onlySlug) queue = queue.filter((e) => e.slug === onlySlug);
if (limit > 0) queue = queue.slice(0, limit);

console.log(`Panova total: ${exercises.length}`);
console.log(`To mirror: ${queue.length}${dryRun ? " (dry-run)" : ""}`);

const map = fs.existsSync(mapPath)
  ? JSON.parse(fs.readFileSync(mapPath, "utf8"))
  : {};

fs.mkdirSync(tmpDir, { recursive: true });

async function uploadMp4(filePath, storagePath) {
  const body = fs.readFileSync(filePath);
  const res = await fetch(
    `${supabaseUrl}/storage/v1/object/media/${storagePath}`,
    {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "video/mp4",
        "x-upsert": "true",
      },
      body,
    },
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Upload failed ${res.status}: ${t.slice(0, 300)}`);
  }
}

async function signedUrl(storagePath) {
  const res = await fetch(
    `${supabaseUrl}/storage/v1/object/sign/media/${storagePath}`,
    {
      method: "POST",
      headers: h,
      body: JSON.stringify({ expiresIn: TEN_YEARS }),
    },
  );
  const data = await res.json();
  if (!res.ok || !data?.signedURL) {
    throw new Error(`Sign failed: ${JSON.stringify(data).slice(0, 300)}`);
  }
  const signed = data.signedURL.startsWith("http")
    ? data.signedURL
    : `${supabaseUrl}/storage/v1${data.signedURL}`;
  return signed;
}

async function patchVideo(id, videoUrl) {
  const res = await fetch(`${supabaseUrl}/rest/v1/exercises?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...h, Prefer: "return=minimal" },
    body: JSON.stringify({ video_url: videoUrl }),
  });
  if (!res.ok) throw new Error(`PATCH failed: ${await res.text()}`);
}

let ok = 0;
let fail = 0;
const failures = [];

for (let i = 0; i < queue.length; i++) {
  const ex = queue[i];
  const n = `[${i + 1}/${queue.length}] ${ex.slug}`;
  console.log(`\n${n}`);
  console.log(`  src: ${ex.video_url}`);

  if (dryRun) {
    ok++;
    continue;
  }

  const outTemplate = path.join(tmpDir, `${ex.slug}.%(ext)s`);
  const dl = spawnSync(
    ytDlp,
    [
      ex.video_url,
      "-f",
      "best[height<=720][ext=mp4]/best[ext=mp4]/bv*[height<=720]+ba/best",
      "--merge-output-format",
      "mp4",
      "--extractor-args",
      "youtube:player_client=android,ios,web",
      "-o",
      outTemplate,
      "--no-playlist",
      "--newline",
      "--no-overwrites",
    ],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );

  if (dl.status !== 0) {
    console.error(`  ✗ yt-dlp: ${(dl.stderr || dl.stdout || "").slice(-400)}`);
    fail++;
    failures.push({ slug: ex.slug, error: "yt-dlp", detail: (dl.stderr || "").slice(-200) });
    continue;
  }

  const files = fs
    .readdirSync(tmpDir)
    .filter((f) => f.startsWith(ex.slug + ".") && /\.(mp4|mkv|webm)$/i.test(f));
  if (!files.length) {
    console.error("  ✗ файл не найден после скачивания");
    fail++;
    failures.push({ slug: ex.slug, error: "no-file" });
    continue;
  }

  let local = path.join(tmpDir, files[0]);
  // Remux to mp4 if needed
  if (!/\.mp4$/i.test(local)) {
    const mp4 = path.join(tmpDir, `${ex.slug}.mp4`);
    const ff = spawnSync(
      "ffmpeg",
      ["-y", "-i", local, "-c", "copy", mp4],
      { encoding: "utf8" },
    );
    if (ff.status !== 0 || !fs.existsSync(mp4)) {
      console.error("  ✗ ffmpeg remux failed");
      fail++;
      failures.push({ slug: ex.slug, error: "ffmpeg" });
      continue;
    }
    try {
      fs.unlinkSync(local);
    } catch {}
    local = mp4;
  }

  const sizeMb = (fs.statSync(local).size / (1024 * 1024)).toFixed(1);
  console.log(`  file: ${path.basename(local)} (${sizeMb} MB)`);

  const storagePath = `exercises/videos/${ex.slug}.mp4`;
  try {
    await uploadMp4(local, storagePath);
    const signed = await signedUrl(storagePath);
    await patchVideo(ex.id, signed);
    map[ex.slug] = {
      source: ex.video_url,
      storagePath,
      mirroredAt: new Date().toISOString(),
      bytes: fs.statSync(local).size,
    };
    fs.writeFileSync(mapPath, JSON.stringify(map, null, 2));
    console.log(`  ✓ uploaded → ${storagePath}`);
    ok++;
  } catch (e) {
    console.error(`  ✗ ${e.message}`);
    fail++;
    failures.push({ slug: ex.slug, error: e.message });
  }

  try {
    fs.unlinkSync(local);
  } catch {}
}

console.log(`\n=== Done: ${ok} ok, ${fail} fail ===`);
if (failures.length) {
  console.log("Failures:");
  for (const f of failures) console.log(`  - ${f.slug}: ${f.error}`);
}
process.exit(fail > 0 && ok === 0 ? 1 : 0);
