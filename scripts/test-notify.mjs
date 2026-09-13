/**
 * Проверка доступности каналов уведомлений с VPS:
 *   node --env-file=.env scripts/test-notify.mjs
 */
const token = process.env.TELEGRAM_BOT_TOKEN || "";
const chatId = process.env.TELEGRAM_CHAT_ID || "";
const webhook = process.env.LEAD_WEBHOOK_URL || "";
const apiBase = (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(
  /\/$/,
  "",
);

console.log("=== test-notify ===\n");

async function tryFetch(label, url, init) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
    const text = await res.text().catch(() => "");
    console.log(
      `${label}: ${res.ok ? "OK" : "FAIL"} HTTP ${res.status} ${text.slice(0, 120)}`,
    );
    return res.ok;
  } catch (e) {
    console.log(`${label}: NETWORK ERROR — ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

await tryFetch("Telegram API ping", `${apiBase}/`, { method: "GET" });

if (token && chatId) {
  await tryFetch("Telegram sendMessage", `${apiBase}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: /^-?\d+$/.test(chatId) ? Number(chatId) : chatId,
      text: "Тест PanovaPRO: если видите это — Telegram с сервера работает.",
    }),
  });
} else {
  console.log("Telegram sendMessage: SKIP (нет TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)");
}

if (webhook) {
  await tryFetch("LEAD_WEBHOOK_URL", webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: "Тест PanovaPRO webhook",
      full_name: "Тест",
      phone: "+70000000000",
      email: "test@example.com",
    }),
  });
} else {
  console.log("LEAD_WEBHOOK_URL: не задан — это основной рабочий канал с RU VPS");
  console.log("  → Make.com: Webhooks → Telegram, URL в .env как LEAD_WEBHOOK_URL=");
}

console.log("\nГотово.");
