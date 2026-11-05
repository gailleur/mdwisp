// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

import { describe, expect, it } from "vitest";

import { COMMANDS, FORMAT_PREFIX, PALETTE_KEYS, type Command } from "./commands";
import { BLOCK_CHOICES } from "./format";
import { helpSections } from "./help";

const commands: readonly Command[] = COMMANDS;

describe("COMMANDS", () => {
  it("has no two commands with the same id or the same shortcut", () => {
    const ids = commands.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = [...commands.flatMap((c) => c.keys ?? []), PALETTE_KEYS];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("agrees with the block picker on the Format shortcuts", () => {
    for (const [kind, , keys] of BLOCK_CHOICES) {
      expect(commands.find((c) => c.id === `${FORMAT_PREFIX}${kind}`)?.keys).toBe(keys);
    }
  });

  it("lists no shortcut the help panel does not explain", () => {
    const help = helpSections(true)
      .flatMap((section) => section.rows ?? [])
      .map((row) => `${row.keys} ${row.what}`)
      .join("\n");
    // Headings 2 to 5 are covered by the row "⌘⌥1 … ⌘⌥6".
    const implied = new Set(["⌘⌥2", "⌘⌥3", "⌘⌥4", "⌘⌥5"]);
    const missing = [...commands.flatMap((c) => c.keys ?? []), PALETTE_KEYS].filter((keys) => !implied.has(keys) && !help.includes(keys));
    expect(missing).toEqual([]);
  });
});
