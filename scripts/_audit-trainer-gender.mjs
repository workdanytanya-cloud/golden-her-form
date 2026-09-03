import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function strip(v) {
  v = (v ?? "").trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
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
const h = { apikey: key, Authorization: `Bearer ${key}` };
const id = "5f75b433-8b2d-46ac-9a8b-a708634cb3d7";

const FEMALE = new Set([
  "trainer_female",
  "female_demo",
  "woman_demo",
  "female_trainer",
]);
const MALE = new Set(["trainer_male", "male_demo", "man_demo", "male_trainer"]);

const prof = await fetch(
  `${url}/rest/v1/profiles?id=eq.${id}&select=id,full_name,gender`,
  { headers: h },
).then((r) => r.json());
console.log("profile", JSON.stringify(prof, null, 2));

const ex = await fetch(
  `${url}/rest/v1/exercises?select=id,slug,name,video_url,tags,category&video_url=not.is.null`,
  { headers: h },
).then((r) => r.json());

const has = (e, set) => (e.tags || []).some((t) => set.has(String(t).toLowerCase()));
const female = ex.filter((e) => has(e, FEMALE));
const male = ex.filter((e) => has(e, MALE));
const neither = ex.filter((e) => !has(e, FEMALE) && !has(e, MALE));

console.log({
  totalWithVideo: ex.length,
  femaleTagged: female.length,
  maleTagged: male.length,
  untagged: neither.length,
});
console.log(
  "male samples",
  male.slice(0, 12).map((e) => ({
    slug: e.slug,
    name: e.name,
    tags: e.tags,
    url: (e.video_url || "").slice(0, 80),
  })),
);
console.log(
  "untagged samples",
  neither.slice(0, 20).map((e) => ({
    slug: e.slug,
    name: e.name,
    tags: e.tags,
    url: (e.video_url || "").slice(0, 90),
  })),
);

// Current Anna program exercise genders
const prog = await fetch(
  `${url}/rest/v1/training_programs?user_id=eq.${id}&select=id&order=generated_at.desc&limit=1`,
  { headers: h },
).then((r) => r.json());
const programId = prog[0]?.id;
const all = await fetch(`${url}/rest/v1/exercises?select=slug,name,tags,video_url,gif_url`, {
  headers: { ...h, Range: "0-999" },
}).then((r) => r.json());
const sheet = all.filter((e) => (e.tags || []).some((t) => t === "sheet" || t === "panova"));
const nonsheet = all.filter((e) => !(e.tags || []).some((t) => t === "sheet" || t === "panova"));
console.log({ all: all.length, sheet: sheet.length, nonsheet: nonsheet.length });
console.log(
  "nonsheet sample",
  nonsheet.slice(0, 30).map((e) => ({
    slug: e.slug,
    tags: e.tags,
    v: (e.video_url || e.gif_url || "").slice(0, 80),
  })),
);

if (programId) {
  const days = await fetch(
    `${url}/rest/v1/training_program_days?program_id=eq.${programId}&is_rest=eq.false&select=title,warmup,exercises,cooldown&limit=3`,
    { headers: h },
  ).then((r) => r.json());
  const ids = new Set();
  for (const d of days) {
    for (const sec of ["warmup", "exercises", "cooldown"]) {
      for (const s of d[sec] || []) if (s.exercise_id) ids.add(s.exercise_id);
    }
  }
  const byId = Object.fromEntries(ex.map((e) => [e.id, e]));
  const used = [...ids].map((i) => byId[i]).filter(Boolean);
  console.log(
    "anna program exercises gender",
    used.map((e) => ({
      name: e.name,
      slug: e.slug,
      female: has(e, FEMALE),
      male: has(e, MALE),
      tags: e.tags,
      url: (e.video_url || "").slice(0, 70),
    })),
  );
}
