import { createRequire } from "node:module";

/**
 * @supabase/realtime-js при createClient требует global WebSocket.
 * В Node 20 его нет — поднимаем из пакета `ws`.
 */
export function ensureNodeWebSocket(): void {
  const g = globalThis as typeof globalThis & { WebSocket?: unknown };
  if (typeof g.WebSocket !== "undefined") return;

  try {
    const require = createRequire(import.meta.url);
    const wsMod = require("ws") as { WebSocket?: unknown } & ((...args: unknown[]) => unknown);
    const Ctor = (wsMod.WebSocket ?? wsMod) as typeof WebSocket;
    g.WebSocket = Ctor;
  } catch (err) {
    console.error("[Supabase] Failed to polyfill WebSocket from 'ws':", err);
  }
}
