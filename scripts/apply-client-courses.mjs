import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sql = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20260831120000_client_courses.sql"),
  "utf8",
);

const endpoints = ["/pg/query", "/pg-meta/default/query", "/postgres/v1/query"];

async function tryEndpoint(ep, body) {
  const r = await fetch(url + ep, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, text: text.slice(0, 600) };
}

for (const ep of endpoints) {
  for (const body of [{ query: sql }, { sql }]) {
    try {
      const res = await tryEndpoint(ep, body);
      console.log(ep, Object.keys(body)[0], res.status, res.text);
      if (res.status >= 200 && res.status < 300) process.exit(0);
    } catch (e) {
      console.log(ep, "ERR", e.message);
    }
  }
}

console.error(
  "\nНе удалось применить SQL автоматически.\n" +
    "Откройте Supabase → SQL Editor и выполните:\n" +
    "  supabase/migrations/20260831120000_client_courses.sql\n",
);
process.exit(2);
