/**
 * Создаёт / обновляет аккаунт тренера-админа в Supabase (без WebSocket).
 *
 *   node --env-file=.env scripts/ensure-admin.mjs
 *
 * Пароль: ADMIN_PASSWORD в окружении (по умолчанию admin12345 — смените потом).
 */
const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(
  /\/$/,
  "",
);
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const email = (
  process.env.ADMIN_EMAIL || "panova.fortuna@gmail.com"
)
  .trim()
  .toLowerCase();
const password = process.env.ADMIN_PASSWORD || "admin12345";
const fullName = process.env.ADMIN_FULL_NAME || "Татьяна Панова";

if (!url || !serviceKey) {
  console.error("Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Пароль должен быть не короче 8 символов");
  process.exit(1);
}

async function authAdmin(pathname, { method = "GET", body } = {}) {
  const res = await fetch(`${url}/auth/v1${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = json?.msg || json?.message || json?.error_description || text;
    throw new Error(`${method} ${pathname} → ${res.status}: ${msg}`);
  }
  return json;
}

async function rest(pathname, { method = "GET", body, prefer } = {}) {
  const headers = {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${url}/rest/v1${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    const msg =
      (json && (json.message || json.msg || JSON.stringify(json))) || text;
    throw new Error(`${method} ${pathname} → ${res.status}: ${msg}`);
  }
  return json;
}

async function findUserByEmail(target) {
  // list users — paginate
  for (let page = 1; page <= 20; page++) {
    const data = await authAdmin(
      `/admin/users?page=${page}&per_page=200`,
    );
    const users = data?.users || [];
    const found = users.find((u) => (u.email || "").toLowerCase() === target);
    if (found) return found;
    if (users.length < 200) return null;
  }
  return null;
}

console.log(`Ensure admin: ${email}`);

let user = await findUserByEmail(email);

if (!user) {
  const created = await authAdmin("/admin/users", {
    method: "POST",
    body: {
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    },
  });
  user = created?.user || created;
  console.log("✓ Пользователь создан:", user.id);
} else {
  await authAdmin(`/admin/users/${user.id}`, {
    method: "PUT",
    body: {
      password,
      email_confirm: true,
      user_metadata: {
        ...(user.user_metadata || {}),
        full_name: user.user_metadata?.full_name || fullName,
      },
    },
  });
  console.log("✓ Пользователь уже был — пароль обновлён:", user.id);
}

// role admin
try {
  await rest("/user_roles", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: { user_id: user.id, role: "admin" },
  });
} catch (e) {
  // duplicate ok — try plain insert ignore
  if (!String(e.message).includes("duplicate") && !String(e.message).includes("23505")) {
    // upsert via delete client + insert admin
    console.warn("insert admin role:", e.message);
  }
}

await rest(
  `/user_roles?user_id=eq.${user.id}&role=eq.client`,
  { method: "DELETE" },
).catch(() => {});

// ensure profile exists
await rest("/profiles", {
  method: "POST",
  prefer: "resolution=merge-duplicates,return=minimal",
  body: { id: user.id, full_name: fullName },
}).catch(() => {});

const roles = await rest(
  `/user_roles?user_id=eq.${user.id}&select=role`,
);
console.log(
  "✓ Роли:",
  Array.isArray(roles) && roles.length
    ? roles.map((r) => r.role).join(", ")
    : "(проверьте вручную в Table Editor → user_roles)",
);

console.log("\nВход на сайт: /auth");
console.log(`Email: ${email}`);
console.log("После входа откроется /admin");
console.log("Рекомендуется сменить пароль после первого входа.");
