// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

import { fileURLToPath } from "node:url";

import { defineConfig, type Plugin } from "vite";

const host = process.env.TAURI_DEV_HOST;

/**
 * Mermaid lazily imports an ELK layout chunk that no default diagram uses.
 * Point that import at a small stub so the 1.4 MB chunk is never bundled.
 */
function dropMermaidElk(): Plugin {
  const stub = fileURLToPath(new URL("./src/stubs/elk.ts", import.meta.url));
  return {
    name: "mdwisp:drop-mermaid-elk",
    enforce: "pre",
    resolveId(source, importer) {
      if (importer?.includes("/mermaid/") && /\/elk-[A-Z0-9]+\.mjs$/.test(source)) return stub;
      return null;
    },
  };
}

export default defineConfig({
  plugins: [dropMermaidElk()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
