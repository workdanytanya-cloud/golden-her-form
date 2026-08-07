const path = require("node:path");
const fs = require("node:fs");

/** Load KEY=VALUE pairs from .env into an object (no dotenv dependency). */
function loadEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) {
    console.warn("[ecosystem] .env not found at", filePath);
    return out;
  }
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const envPath = path.join(__dirname, ".env");
const fileEnv = loadEnvFile(envPath);

const notifyKeys = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
  "LEAD_NOTIFY_EMAIL",
];
console.log(
  "[ecosystem] loading",
  envPath,
  "→",
  notifyKeys.map((k) => `${k}=${fileEnv[k] ? "yes" : "NO"}`).join(", "),
);

module.exports = {
  apps: [
    {
      name: "panovapro",
      cwd: __dirname,
      script: path.join(".output", "server", "index.mjs"),
      interpreter: "node",
      // Node 20+: also inject .env into process (backup to env: below)
      interpreter_args: fs.existsSync(envPath) ? `--env-file=${envPath}` : "",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
        HOST: "127.0.0.1",
        ...fileEnv,
      },
    },
  ],
};
