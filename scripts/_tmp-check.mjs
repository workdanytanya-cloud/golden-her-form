function fetchWithTimeout(url, opts={}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
}
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
