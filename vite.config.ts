import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { execSync } from "node:child_process";

function shortGitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const defineEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    defineEnv[`import.meta.env.${key}`] = JSON.stringify(value);
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
