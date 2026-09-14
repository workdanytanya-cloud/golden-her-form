import fs from "node:fs";
import path from "node:path";

/** Ключи локального контура: .env.selfhost важнее .env, процесс не должен уехать на облако. */
const SELFHOST_KEYS = new Set([
  "AUTH_BACKEND",
  "DATA_BACKEND",
  "MEDIA_BACKEND",
  "DATABASE_URL",
  "SESSION_COOKIE_SECURE",
]);

function parseEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return out;
  const text = fs.readFileSync(filePath, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
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

export function loadSelfhostEnvFiles(cwd = process.cwd()): void {
  const fromDotEnv = parseEnvFile(path.join(cwd, ".env"));
  const fromSelfhost = parseEnvFile(path.join(cwd, ".env.selfhost"));

  for (const [key, value] of Object.entries(fromDotEnv)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  for (const [key, value] of Object.entries(fromSelfhost)) {
    if (SELFHOST_KEYS.has(key)) {
      process.env[key] = value;
      continue;
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function databaseTargetFromEnv(): { host: string; port: string; database: string } | null {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return {
      host: parsed.hostname,
      port: parsed.port || "5432",
      database: parsed.pathname.replace(/^\//, ""),
    };
  } catch {
    return null;
  }
}
