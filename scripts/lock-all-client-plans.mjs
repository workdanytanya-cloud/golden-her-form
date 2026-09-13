/**
 * Зафиксировать все существующие программы тренировок и планы питания
 * (targets_manual = true), чтобы клиентский кабинет их не пересобирал.
 *
 * node --env-file=.env scripts/lock-all-client-plans.mjs [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dryRun = process.argv.includes("--dry-run");

const raw = fs.readFileSync(path.join(root, ".env"), "utf8");
const env = {};
for (const line of raw.split(/\r?\n/)) {
  if (!line || !line.includes("=")) continue;
  const i = line.indexOf("=");
  env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL).replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const h = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const unlockedPrograms = await fetch(
  `${url}/rest/v1/training_programs?select=id,user_id&targets_manual=eq.false`,
  { headers: h },
).then((r) => r.json());
const unlockedPlans = await fetch(
  `${url}/rest/v1/nutrition_plans?select=id,user_id&targets_manual=eq.false`,
  { headers: h },
).then((r) => r.json());

console.log(`Unlocked training programs: ${unlockedPrograms.length}`);
console.log(`Unlocked nutrition plans: ${unlockedPlans.length}`);
if (dryRun) {
  console.log("Dry run — ничего не изменено");
  process.exit(0);
}

if (unlockedPrograms.length) {
  const res = await fetch(`${url}/rest/v1/training_programs?targets_manual=eq.false`, {
    method: "PATCH",
    headers: h,
    body: JSON.stringify({ targets_manual: true }),
  });
  if (!res.ok) throw new Error(await res.text());
  console.log(`✓ Locked ${unlockedPrograms.length} training programs`);
}

if (unlockedPlans.length) {
  const res = await fetch(`${url}/rest/v1/nutrition_plans?targets_manual=eq.false`, {
    method: "PATCH",
    headers: h,
    body: JSON.stringify({ targets_manual: true }),
  });
  if (!res.ok) throw new Error(await res.text());
  console.log(`✓ Locked ${unlockedPlans.length} nutrition plans`);
}

console.log("Done");
