import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { execSync } from "node:child_process";
import { loadSelfhostEnvFiles } from "./src/lib/selfhost/load-env";

function shortGitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig(({ mode, command }) => {
  loadSelfhostEnvFiles();
  const env = loadEnv(mode, process.cwd(), "");
  const viteEnv = loadEnv(mode, process.cwd(), "VITE_");
  // SSR / server functions читают SUPABASE_* из process.env.
  // AUTH/DATA/DATABASE из .env.selfhost уже выставлены и не должны быть затёрты .env.
  for (const [key, value] of Object.entries(env)) {
    if (
      key === "AUTH_BACKEND" ||
      key === "DATA_BACKEND" ||
      key === "MEDIA_BACKEND" ||
      key === "DATABASE_URL" ||
      key === "SESSION_COOKIE_SECURE"
    ) {
      continue;
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
  const defineEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(viteEnv)) {
    defineEnv[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  // Self-host release: do not embed cloud Supabase keys into the browser bundle.
  const selfhostRuntime =
    (process.env.AUTH_BACKEND === "local" || env.AUTH_BACKEND === "local") &&
    (process.env.DATA_BACKEND === "postgres" || env.DATA_BACKEND === "postgres");
  if (selfhostRuntime) {
    defineEnv["import.meta.env.VITE_SUPABASE_URL"] = JSON.stringify("");
    defineEnv["import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY"] = JSON.stringify("");
    defineEnv["import.meta.env.VITE_SUPABASE_PROJECT_ID"] = JSON.stringify("");
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  }

  // Локально и на обычном VPS — Node. На Vercel/Netlify Nitro сам подставит нужный preset.
  const nitroPreset = process.env.NITRO_PRESET || (command === "build" ? "node-server" : undefined);

  return {
    define: {
      ...defineEnv,
      "import.meta.env.VITE_BUILD_SHA": JSON.stringify(shortGitSha()),
    },
    css: {
      // Как в прежнем Lovable-конфиге: не цепляем чужой PostCSS/Tailwind v3 из родительской папки
      transformer: "lightningcss",
    },
    resolve: {
      alias: { "@": path.resolve(process.cwd(), "src") },
      tsconfigPaths: true,
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    server: {
      host: true,
      port: 3000,
    },
    ssr: {
      // Не externalize ws: иначе serverFn не находит native WebSocket в Node 20.
      noExternal: ["ws"],
      // pdfkit is CJS and uses __dirname; keep it external so Node loads the package as CJS.
      external: ["pg", "argon2", "bcryptjs", "pdfkit"],
    },
    plugins: [
      tailwindcss(),
      tanstackStart({
        // SSR-обёртка ошибок в src/server.ts
        server: { entry: "server" },
      }),
      nitro(nitroPreset ? { preset: nitroPreset } : {}),
      viteReact(),
    ],
  };
});
