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
const res = await fetch(`${url}/rest/v1/exercises?select=slug,name,gif_url,video_url&order=name`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
const d = await res.json();
console.log("TOTAL", d.length);
console.log("gif set", d.filter((x) => x.gif_url).length);
console.log("video set", d.filter((x) => x.video_url).length);
console.log("neither", d.filter((x) => !x.gif_url && !x.video_url).length);
const sample = d.filter((x) => /мостик|монстр|ракуш|glute|clamshell|monster/i.test(x.name + x.slug));
console.log("sample named:", JSON.stringify(sample, null, 2));
const withGif = d.filter((x) => x.gif_url).slice(0, 5);
console.log("gif examples:", JSON.stringify(withGif, null, 2));
