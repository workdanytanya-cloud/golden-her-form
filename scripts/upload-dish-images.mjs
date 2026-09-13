/**
 * Загрузка сгенерированных PNG в Supabase Storage + update dishes.image_url
 *
 * Ожидает файлы в scripts/dish-images/<slug>.png
 * Запуск: node scripts/upload-dish-images.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dir = path.join(__dirname, "dish-images");

function loadEnv() {
  const raw = fs.readFileSync(path.join(root, ".env"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    env[k] = v;
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

if (!fs.existsSync(dir)) {
  console.error("Folder missing:", dir);
  process.exit(1);
}

const files = fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
console.log(`Found ${files.length} images in ${dir}`);

let ok = 0;
let fail = 0;

for (const file of files) {
  const slug = file.replace(/\.(png|jpe?g|webp)$/i, "");
  const ext = file.split(".").pop().toLowerCase();
  const contentType =
    ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  const bytes = fs.readFileSync(path.join(dir, file));
  const storagePath = `dishes/images/${slug}.${ext}`;

  const up = await fetch(`${url}/storage/v1/object/media/${storagePath}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!up.ok) {
    console.error("UPLOAD FAIL", slug, up.status, await up.text());
    fail++;
    continue;
  }

  // Prefer public URL if bucket is public; else long-lived signed URL
  const publicUrl = `${url}/storage/v1/object/public/media/${storagePath}`;
  const signRes = await fetch(`${url}/storage/v1/object/sign/media/${storagePath}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 365 * 10 }),
  });
  let imageUrl = publicUrl;
  if (signRes.ok) {
    const signed = await signRes.json();
    if (signed?.signedURL) {
      imageUrl = signed.signedURL.startsWith("http")
        ? signed.signedURL
        : `${url}/storage/v1${signed.signedURL}`;
    }
  }

  const patch = await fetch(`${url}/rest/v1/dishes?slug=eq.${encodeURIComponent(slug)}`, {
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
    console.error("PATCH FAIL", slug, patch.status, await patch.text());
    fail++;
    continue;
  }
  ok++;
  console.log("OK", slug);
}

console.log(`Done. ok=${ok} fail=${fail}`);
