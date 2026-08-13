/**
 * Зеркалирует Rutube (и оставшиеся YouTube) panova/legacy упражнений в mp4 Storage.
 * node --env-file=.env scripts/mirror-remaining-videos.mjs [--limit=N] [--kind=rutube|youtube|all]
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

const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 0;
const kindArg = process.argv.find((a) => a.startsWith("--kind="));
const kind = (kindArg?.split("=")[1] || "all").toLowerCase();

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

function findYtDlp() {
  const candidates = [
    "yt-dlp",
    path.join(
      process.env.LOCALAPPDATA || "",
      "Microsoft\\WinGet\\Packages\\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\\yt-dlp.exe",
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

function isHosted(url) {
  return /\/storage\/v1\/object\//i.test(url || "") || /\.(mp4|webm|mov)(\?|$)/i.test(url || "");
}
function isYoutube(url) {
  return /youtu\.?be|youtube\.com/i.test(url || "");
}
function isRutube(url) {
  return /rutube\.ru/i.test(url || "");
}

const env = loadEnv();
const supabaseUrl = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const h = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};
const ytDlp = findYtDlp();
if (!ytDlp) {
  console.error("yt-dlp not found");
  process.exit(1);
}

const all = [];
let offset = 0;
while (true) {
  const chunk = await fetch(
    `${supabaseUrl}/rest/v1/exercises?select=id,slug,name,video_url,tags&order=slug&offset=${offset}&limit=1000`,
    { headers: h },
  ).then((r) => r.json());
  if (!chunk.length) break;
  all.push(...chunk);
  offset += chunk.length;
  if (chunk.length < 1000) break;
}

let queue = all.filter((e) => e.video_url && !isHosted(e.video_url));
if (kind === "youtube") queue = queue.filter((e) => isYoutube(e.video_url));
else if (kind === "rutube") queue = queue.filter((e) => isRutube(e.video_url));
if (limit > 0) queue = queue.slice(0, limit);

console.log(`To mirror: ${queue.length} (kind=${kind})`);
fs.mkdirSync(tmpDir, { recursive: true });
const map = fs.existsSync(mapPath) ? JSON.parse(fs.readFileSync(mapPath, "utf8")) : {};

async function upload(filePath, storagePath) {
  const body = fs.readFileSync(filePath);
  const res = await fetch(`${supabaseUrl}/storage/v1/object/media/${storagePath}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "video/mp4",
      "x-upsert": "true",
    },
    body,
  });
  if (!res.ok) throw new Error(`upload ${res.status} ${(await res.text()).slice(0, 200)}`);
}

async function signed(storagePath) {
  const res = await fetch(`${supabaseUrl}/storage/v1/object/sign/media/${storagePath}`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ expiresIn: TEN_YEARS }),
  });
  const data = await res.json();
  if (!res.ok || !data?.signedURL) throw new Error(`sign ${JSON.stringify(data).slice(0, 200)}`);
  return data.signedURL.startsWith("http")
    ? data.signedURL
    : `${supabaseUrl}/storage/v1${data.signedURL}`;
}

let ok = 0;
let fail = 0;
const failures = [];

for (let i = 0; i < queue.length; i++) {
  const ex = queue[i];
  console.log(`\n[${i + 1}/${queue.length}] ${ex.slug}`);
  console.log(`  ${ex.video_url}`);

  const outTemplate = path.join(tmpDir, `${ex.slug}.%(ext)s`);
  const args = [
    ex.video_url,
    "-f",
    "best[height<=480][ext=mp4]/best[height<=720][ext=mp4]/best[ext=mp4]/bv*[height<=480]+ba/best",
    "--merge-output-format",
    "mp4",
    "-o",
    outTemplate,
    "--no-playlist",
    "--newline",
    "--force-overwrites",
    "--socket-timeout",
    "60",
    "--retries",
    "5",
    "--fragment-retries",
    "5",
  ];
  if (isYoutube(ex.video_url)) {
    args.push("--extractor-args", "youtube:player_client=android,ios,web");
  }

  const dl = spawnSync(ytDlp, args, { encoding: "utf8", maxBuffer: 30 * 1024 * 1024 });
  if (dl.status !== 0) {
    console.error(`  ✗ yt-dlp ${(dl.stderr || dl.stdout || "").slice(-300)}`);
    fail++;
    failures.push({ slug: ex.slug, error: "yt-dlp" });
    continue;
  }

  const files = fs
    .readdirSync(tmpDir)
    .filter((f) => f.startsWith(ex.slug + ".") && /\.(mp4|mkv|webm)$/i.test(f));
  if (!files.length) {
    fail++;
    failures.push({ slug: ex.slug, error: "no-file" });
    continue;
  }

  let local = path.join(tmpDir, files[0]);
  if (!/\.mp4$/i.test(local)) {
    const mp4 = path.join(tmpDir, `${ex.slug}.mp4`);
    const ff = spawnSync("ffmpeg", ["-y", "-i", local, "-c", "copy", mp4], { encoding: "utf8" });
    if (ff.status !== 0 || !fs.existsSync(mp4)) {
      fail++;
      failures.push({ slug: ex.slug, error: "ffmpeg" });
      continue;
    }
    try {
      fs.unlinkSync(local);
    } catch {}
    local = mp4;
  }

  const mb = fs.statSync(local).size / (1024 * 1024);
  console.log(`  file ${mb.toFixed(1)} MB`);

  // Compress if too large for Storage (≈50MB default limit)
  if (mb > 45) {
    const compressed = path.join(tmpDir, `${ex.slug}.small.mp4`);
    console.log(`  compressing…`);
    const ff = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-i",
        local,
        "-vf",
        "scale=-2:480",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        compressed,
      ],
      { encoding: "utf8" },
    );
    if (ff.status === 0 && fs.existsSync(compressed)) {
      try {
        fs.unlinkSync(local);
      } catch {}
      local = compressed;
      console.log(`  compressed ${(fs.statSync(local).size / (1024 * 1024)).toFixed(1)} MB`);
    }
  }

  const storagePath = `exercises/videos/${ex.slug}.mp4`;
  try {
    await upload(local, storagePath);
    // Prefer public URL when bucket is public
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/media/${storagePath}`;
    let finalUrl = publicUrl;
    const head = await fetch(publicUrl, { method: "HEAD" });
    if (!head.ok) {
      finalUrl = await signed(storagePath);
    }
    const patch = await fetch(`${supabaseUrl}/rest/v1/exercises?id=eq.${ex.id}`, {
      method: "PATCH",
      headers: { ...h, Prefer: "return=minimal" },
      body: JSON.stringify({ video_url: finalUrl }),
    });
    if (!patch.ok) throw new Error(await patch.text());
    map[ex.slug] = {
      source: ex.video_url,
      storagePath,
      mirroredAt: new Date().toISOString(),
      bytes: fs.statSync(local).size,
    };
    fs.writeFileSync(mapPath, JSON.stringify(map, null, 2));
    console.log(`  ✓ ${storagePath}`);
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

console.log(`\n=== ${ok} ok, ${fail} fail ===`);
for (const f of failures) console.log(`- ${f.slug}: ${f.error}`);
process.exit(fail && !ok ? 1 : 0);
