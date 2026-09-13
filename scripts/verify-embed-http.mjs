/**
 * HEAD-проверка embed URL упражнений panova в Supabase.
 * node --env-file=.env scripts/verify-embed-http.mjs [--sample=20]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getVideoEmbedUrl } from "./exercises-sheet.lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const sampleArg = process.argv.find((a) => a.startsWith("--sample="));
const sampleSize = sampleArg ? parseInt(sampleArg.split("=")[1], 10) : 0;

function loadEnv() {
  const raw = fs.readFileSync(path.join(root, ".env"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || !line.includes("=")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL).replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: key, Authorization: `Bearer ${key}` };

const all = await fetch(
  `${url}/rest/v1/exercises?select=slug,name,video_url,tags&tags=cs.{panova}&order=slug`,
  { headers: h },
).then((r) => r.json());

const list = sampleSize > 0 ? all.filter((_, i) => i % Math.ceil(all.length / sampleSize) === 0).slice(0, sampleSize) : all;

let ok = 0;
let fail = 0;

for (const ex of list) {
  const embed = getVideoEmbedUrl(ex.video_url);
  if (!embed) {
    console.log(`✗ ${ex.slug}: no embed`);
    fail++;
    continue;
  }
  try {
    const res = await fetch(embed, { method: "HEAD", redirect: "follow" });
    if (res.ok || res.status === 405) {
      ok++;
    } else {
      console.log(`✗ ${ex.slug}: HTTP ${res.status}`);
      console.log(`  ${embed}`);
      fail++;
    }
  } catch (e) {
    console.log(`✗ ${ex.slug}: ${e.message}`);
    fail++;
  }
}

console.log(`\nHTTP: ${ok} OK, ${fail} fail из ${list.length} (всего panova: ${all.length})`);
process.exit(fail > 0 ? 1 : 0);
