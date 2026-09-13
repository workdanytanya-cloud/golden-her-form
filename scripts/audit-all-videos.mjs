/**
 * Полная проверка всех video_url в exercises:
 * - embed (YouTube/Rutube)
 * - прямые mp4 / signed Supabase
 *
 * node --env-file=.env scripts/audit-all-videos.mjs [--fix-signs]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getVideoEmbedUrl } from "./exercises-sheet.lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const fixSigns = process.argv.includes("--fix-signs");

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
const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const TEN_YEARS = 60 * 60 * 24 * 365 * 10;

async function fetchAll() {
  const all = [];
  let offset = 0;
  while (true) {
    const chunk = await fetch(
      `${url}/rest/v1/exercises?select=id,slug,name,video_url,tags&order=slug&offset=${offset}&limit=1000`,
      { headers: h },
    ).then((r) => r.json());
    if (!Array.isArray(chunk) || !chunk.length) break;
    all.push(...chunk);
    offset += chunk.length;
    if (chunk.length < 1000) break;
  }
  return all;
}

function classify(videoUrl) {
  if (!videoUrl) return "empty";
  if (/youtu\.?be|youtube\.com/i.test(videoUrl)) return "youtube";
  if (/rutube/i.test(videoUrl)) return "rutube";
  if (/\/storage\/v1\/object\//i.test(videoUrl) || /\.(mp4|webm|mov)(\?|$)/i.test(videoUrl))
    return "file";
  return "other";
}

function extractStoragePath(videoUrl) {
  try {
    const u = new URL(videoUrl);
    // /storage/v1/object/sign/media/exercises/videos/x.mp4?token=
    // /storage/v1/object/public/media/...
    const m = u.pathname.match(/\/storage\/v1\/object\/(?:sign|public)\/media\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

async function checkUrl(target, kind) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 20000);
  try {
    let res = await fetch(target, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });
    if (res.status === 405 || res.status === 403 || res.status === 400) {
      res = await fetch(target, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: kind === "file" ? { Range: "bytes=0-1023" } : {},
      });
    }
    clearTimeout(t);
    return { ok: res.ok || res.status === 206, status: res.status, final: res.url };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, status: 0, error: e.message };
  }
}

async function resign(storagePath) {
  const res = await fetch(`${url}/storage/v1/object/sign/media/${storagePath}`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ expiresIn: TEN_YEARS }),
  });
  const data = await res.json();
  if (!res.ok || !data?.signedURL) throw new Error(JSON.stringify(data).slice(0, 200));
  return data.signedURL.startsWith("http")
    ? data.signedURL
    : `${url}/storage/v1${data.signedURL}`;
}

const exercises = (await fetchAll()).filter((e) => e.video_url);
console.log(`Exercises with video: ${exercises.length}\n`);

const results = { ok: [], fail: [], byKind: {} };

for (let i = 0; i < exercises.length; i++) {
  const e = exercises[i];
  const kind = classify(e.video_url);
  results.byKind[kind] = (results.byKind[kind] || 0) + 1;

  let target = e.video_url;
  const embed = getVideoEmbedUrl(e.video_url);
  if (embed) target = embed;

  process.stdout.write(`[${i + 1}/${exercises.length}] ${e.slug} (${kind})… `);
  const check = await checkUrl(target, embed ? "embed" : kind);

  if (check.ok) {
    console.log(`OK ${check.status}`);
    results.ok.push(e);
    continue;
  }

  console.log(`FAIL ${check.status || check.error}`);

  // Try re-sign storage URLs
  if (kind === "file" && fixSigns) {
    const storagePath = extractStoragePath(e.video_url);
    if (storagePath) {
      try {
        const fresh = await resign(storagePath);
        const recheck = await checkUrl(fresh, "file");
        if (recheck.ok) {
          await fetch(`${url}/rest/v1/exercises?id=eq.${e.id}`, {
            method: "PATCH",
            headers: { ...h, Prefer: "return=minimal" },
            body: JSON.stringify({ video_url: fresh }),
          });
          console.log(`  → re-signed OK`);
          results.ok.push(e);
          continue;
        }
        console.log(`  → re-sign still fail ${recheck.status}`);
      } catch (err) {
        console.log(`  → re-sign error ${err.message}`);
      }
    }
  }

  results.fail.push({
    slug: e.slug,
    name: e.name,
    kind,
    video_url: e.video_url,
    target,
    status: check.status,
    error: check.error,
    tags: e.tags,
  });
}

console.log(`\n=== Summary ===`);
console.log("By kind:", results.byKind);
console.log(`OK: ${results.ok.length}, FAIL: ${results.fail.length}`);

const out = path.join(__dirname, "_video_audit_fail.json");
fs.writeFileSync(out, JSON.stringify(results.fail, null, 2));
console.log(`Failures written: ${out}`);

if (results.fail.length) {
  console.log("\nFailures:");
  for (const f of results.fail) {
    console.log(`- ${f.slug} [${f.kind}] ${f.status || f.error}`);
    console.log(`  ${f.video_url?.slice(0, 100)}`);
  }
}

process.exit(results.fail.length ? 1 : 0);
