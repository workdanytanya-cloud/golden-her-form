/**
 * Проверка переменных уведомлений на сервере:
 *   node --env-file=.env scripts/check-notify-env.mjs
 */
const keys = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "LEAD_WEBHOOK_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "TELEGRAM_API_BASE",
  "RESEND_API_KEY",
  "SMTP_ENABLED",
  "SMTP_HOST",
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
