/**
 * Проставляет теги trainer_female / trainer_male и пол Анны.
 *   node scripts/apply-trainer-gender-tags.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function strip(v) {
  v = (v ?? "").trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  )
    return v.slice(1, -1);
  return v;
}
const raw = fs.readFileSync(path.join(__dirname, "../.env"), "utf8");
const env = {};
for (const line of raw.split(/\r?\n/)) {
  if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  env[line.slice(0, i).trim()] = strip(line.slice(i + 1));
}
const url = strip(env.SUPABASE_URL || env.VITE_SUPABASE_URL).replace(/\/$/, "");
const key = strip(env.SUPABASE_SERVICE_ROLE_KEY);
const h = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const ANNA = "5f75b433-8b2d-46ac-9a8b-a708634cb3d7";

const anna = await fetch(`${url}/rest/v1/profiles?id=eq.${ANNA}`, {
  method: "PATCH",
  headers: h,
  body: JSON.stringify({ gender: "female" }),
}).then((r) => r.json());
console.log("anna gender ->", anna?.[0]?.gender ?? anna);

const all = await fetch(
  `${url}/rest/v1/exercises?select=id,slug,tags,gif_url,video_url`,
  { headers: { ...h, Range: "0-999" } },
).then((r) => r.json());

function isSheet(e) {
  const tags = e.tags || [];
  return (
    tags.includes("sheet") ||
    tags.includes("panova") ||
    tags.includes("anna-sheet") ||
    String(e.slug || "").startsWith("sheet-")
  );
}

let femaleN = 0;
let maleN = 0;

for (const e of all) {
  const tags = [...(e.tags || [])];
  const hasF = tags.includes("trainer_female");
  const hasM = tags.includes("trainer_male");
  let next = tags;
  if (isSheet(e)) {
    if (!hasF && !hasM) {
      next = [...new Set([...tags, "trainer_female"])];
      femaleN++;
    }
  } else if (String(e.slug || "").startsWith("mfr-")) {
    // leave
  } else if ((e.gif_url || e.video_url) && !hasF && !hasM) {
    next = [...new Set([...tags, "trainer_male"])];
    maleN++;
  }
  if (next !== tags && next.join() !== tags.join()) {
    const res = await fetch(`${url}/rest/v1/exercises?id=eq.${e.id}`, {
      method: "PATCH",
      headers: h,
      body: JSON.stringify({ tags: next }),
    });
    if (!res.ok) {
      console.error("fail", e.slug, await res.text());
    }
  }
}

console.log({ updatedFemaleTags: femaleN, updatedMaleTags: maleN, total: all.length });
