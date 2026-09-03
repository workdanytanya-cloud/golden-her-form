import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raw = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
const env = {};
for (const line of raw.split(/\r?\n/)) {
  if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  let k = line.slice(0, i).trim();
  let v = line.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
    v = v.slice(1, -1);
  env[k] = v;
}
const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL).replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: key, Authorization: "Bearer " + key };

const res = await fetch(`${url}/rest/v1/food_products?select=id,name,kcal_per_100g,protein_per_100g,fat_per_100g,carbs_per_100g,product_group&order=name.asc&limit=200`, { headers: h });
const data = await res.json();
if (!Array.isArray(data)) { console.log("Error:", JSON.stringify(data)); process.exit(1); }

for (const p of data) {
  console.log(`${p.name.padEnd(35)} P:${String(p.protein_per_100g).padStart(5)} F:${String(p.fat_per_100g).padStart(5)} C:${String(p.carbs_per_100g).padStart(5)} K:${String(p.kcal_per_100g).padStart(5)}  group: ${p.product_group ?? '-'}`);
}
console.log(`\nTotal: ${data.length}`);
