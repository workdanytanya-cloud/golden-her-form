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
const h = { apikey: key, Authorization: `Bearer ${key}`, Range: "0-999" };

const all = await fetch(
  `${url}/rest/v1/exercises?select=slug,name,tags,video_url,gif_url`,
  { headers: h },
).then((r) => r.json());

const sheet = all.filter((e) =>
  (e.tags || []).some((t) => t === "sheet" || t === "panova"),
);
const nonsheet = all.filter(
  (e) => !(e.tags || []).some((t) => t === "sheet" || t === "panova"),
);
const sheetWithGif = sheet.filter((e) => e.gif_url);
const both = sheet.filter((e) => e.gif_url && e.video_url);

console.log(
  JSON.stringify(
    {
      all: all.length,
      sheet: sheet.length,
      nonsheet: nonsheet.length,
      sheetWithGif: sheetWithGif.length,
      sheetBothMedia: both.length,
      nonsheetSlugs: nonsheet.map((e) => e.slug).slice(0, 50),
      sheetGifSamples: sheetWithGif.slice(0, 15).map((e) => ({
        slug: e.slug,
        gif: (e.gif_url || "").slice(0, 90),
        video: (e.video_url || "").slice(0, 90),
      })),
      nonsheetSamples: nonsheet.slice(0, 20).map((e) => ({
        slug: e.slug,
        tags: e.tags,
        gif: (e.gif_url || "").slice(0, 80),
        video: (e.video_url || "").slice(0, 80),
      })),
    },
    null,
    2,
  ),
);
