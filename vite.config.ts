// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// Mermaid's ELK layout engine (elkjs, EPL-2.0) stays a separate chunk that
// is only fetched by diagrams asking for `layout: elk`. An earlier build
// swapped that chunk for a stub to save 1.4 MB on disk, which broke every
// flowchart in release builds while dev builds kept working.

export default defineConfig({
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
