import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outfile = path.join(root, "selfhost/nutrition-worker/index.mjs");

function loadEsbuild() {
  try {
    return require("esbuild");
  } catch {
    try {
      return require("vite/node_modules/esbuild");
    } catch {
      return null;
    }
  }
}

const esbuild = loadEsbuild();
if (!esbuild) {
  if (existsSync(outfile)) {
    console.log("esbuild missing; using existing nutrition worker bundle");
    process.exit(0);
  }
  console.error("esbuild missing and nutrition worker bundle is absent");
  process.exit(1);
}

await esbuild.build({
  absWorkingDir: root,
  entryPoints: ["src/lib/nutrition-constructor/generation-worker-entry.ts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  alias: {
    "@": path.join(root, "src"),
  },
  logLevel: "info",
});
