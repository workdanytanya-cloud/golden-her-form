import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function strip(v) {
  v = (v ?? "").trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
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
const pid = "41472090-e7b1-4e8e-85d6-51aa535a0144";
await fetch(`${url}/rest/v1/training_program_days?program_id=eq.${pid}`, { method: "DELETE", headers: h });
await fetch(`${url}/rest/v1/training_programs?id=eq.${pid}`, { method: "DELETE", headers: h });
console.log("deleted program", pid);
