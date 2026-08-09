import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
  if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  let v = line.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
    v = v.slice(1, -1);
  env[line.slice(0, i).trim()] = v;
}
const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const r = await fetch(url + "/rest/v1/dishes?select=id,name,slug,image_url,meal_type&order=name.asc", {
  headers: { apikey: key, Authorization: "Bearer " + key },
});
const d = await r.json();
if (!Array.isArray(d)) {
  console.error(d);
  process.exit(1);
}
const miss = d.filter((x) => !x.image_url);
console.log("dishes", d.length);
console.log("with image", d.length - miss.length);
console.log("missing", miss.length);
for (const x of miss.slice(0, 30)) console.log("-", x.meal_type, "|", x.name, "|", x.slug);
