/**
 * Проверка переменных уведомлений на сервере:
 *   node --env-file=.env scripts/check-notify-env.mjs
 */
const keys = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "LEAD_NOTIFY_EMAIL",
];

console.log("Notify env check:\n");
for (const k of keys) {
  const v = process.env[k];
  const ok = Boolean(v && String(v).trim() && !String(v).includes("..."));
  console.log(`  ${ok ? "✓" : "✗"} ${k}${ok && k.includes("PASS") ? " (set)" : ok && k.includes("TOKEN") ? ` (len=${v.length})` : ok && k.includes("KEY") ? ` (len=${v.length})` : ok ? ` = ${v}` : ""}`);
}
