/**
 * Загрузка PNG из scripts/dish-images и проставление image_url
 * всем блюдам из группы (по dish-image-unique-prompts.json).
 *
 * node scripts/upload-unique-dish-images.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dir = path.join(__dirname, "dish-images");
const promptsPath = path.join(__dirname, "dish-image-unique-prompts.json");

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
const { items } = JSON.parse(fs.readFileSync(promptsPath, "utf8"));

let uploaded = 0;
let linked = 0;
let skipped = 0;
let fail = 0;

for (const item of items) {
  const file = path.join(dir, item.filename);
  if (!fs.existsSync(file)) {
    skipped++;
    continue;
  }
  const bytes = fs.readFileSync(file);
  const storagePath = `dishes/images/${item.filename}`;
  const up = await fetch(`${url}/storage/v1/object/media/${storagePath}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "image/png",
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!up.ok) {
    console.error("UPLOAD FAIL", item.primarySlug, up.status, await up.text());
    fail++;
    continue;
  }
  uploaded++;

  const signRes = await fetch(`${url}/storage/v1/object/sign/media/${storagePath}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 365 * 10 }),
  });
  const signJson = await signRes.json();
  const imageUrl = signJson?.signedURL
    ? `${url}/storage/v1${signJson.signedURL.startsWith("/") ? "" : "/"}${signJson.signedURL}`
    : `${url}/storage/v1/object/public/media/${storagePath}`;

  // обновляем все id группы пачками по 50
  for (let i = 0; i < item.ids.length; i += 50) {
    const chunk = item.ids.slice(i, i + 50);
    const patch = await fetch(`${url}/rest/v1/dishes?id=in.(${chunk.join(",")})`, {
      method: "PATCH",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ image_url: imageUrl }),
    });
    if (!patch.ok) {
      console.error("PATCH FAIL", item.primarySlug, patch.status, await patch.text());
      fail++;
    } else {
      linked += chunk.length;
    }
  }
  console.log("OK", item.filename, "→", item.count, "dishes");
}

console.log({ uploaded, linked, skipped, fail });
