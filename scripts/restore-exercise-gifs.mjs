/**
 * Восстанавливает gif_url упражнений из src/assets/exercises/*.asset.json
 * node scripts/restore-exercise-gifs.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const exercisesDir = path.join(root, "src", "assets", "exercises");

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    env[line.slice(0, i).trim()] = v;
  }
  return env;
}

const env = loadEnv();
const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const files = fs.readdirSync(exercisesDir).filter((f) => f.endsWith(".asset.json"));
const updates = [];
for (const file of files) {
  const meta = JSON.parse(fs.readFileSync(path.join(exercisesDir, file), "utf8"));
  const slug = file.replace(/\.mp4\.asset\.json$/i, "").replace(/\.asset\.json$/i, "");
  if (!meta.url?.startsWith("/__l5e/")) {
    console.warn("skip bad url", file);
    continue;
  }
  updates.push({ slug, gif_url: meta.url });
}

console.log(`Mapped ${updates.length} assets`);

let ok = 0;
let miss = 0;
for (const u of updates) {
  const res = await fetch(
    `${url}/rest/v1/exercises?slug=eq.${encodeURIComponent(u.slug)}`,
    {
      method: "PATCH",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ gif_url: u.gif_url }),
    },
  );
  const body = await res.json();
  if (!res.ok) {
    console.error("FAIL", u.slug, res.status, body);
    continue;
  }
  if (!Array.isArray(body) || body.length === 0) {
    miss++;
    console.warn("NO ROW", u.slug);
    continue;
  }
  ok++;
  console.log("OK", u.slug, "→", u.gif_url);
}

console.log(`Done: updated=${ok} no_row=${miss}`);

// verify
const check = await fetch(`${url}/rest/v1/exercises?select=slug,gif_url`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
const all = await check.json();
console.log(
  `DB: total=${all.length} with_gif=${all.filter((x) => x.gif_url).length} without=${all.filter((x) => !x.gif_url).length}`,
);
