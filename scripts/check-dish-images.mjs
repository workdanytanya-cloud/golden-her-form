import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
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
const res = await fetch(`${url}/rest/v1/dishes?select=slug,name,image_url&order=name`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
const d = await res.json();
const withImg = d.filter((x) => x.image_url);
const without = d.filter((x) => !x.image_url);
console.log("DB total", d.length);
console.log("with image", withImg.length);
console.log("without image", without.length);
if (withImg.length) console.log("have:", withImg.map((x) => x.slug).join(", "));
