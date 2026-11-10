// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

import { describe, expect, it } from "vitest";

import { ENCODING_LABEL, unencodable } from "./encoding";

describe("unencodable", () => {
  it("finds the first character Windows-1252 cannot hold, and nothing in Unicode encodings", () => {
    expect(unencodable("café € “quoted” — naïve", "windows-1252")).toBeNull();
    expect(unencodable("tick ✓ and 😀", "windows-1252")).toBe("✓");
    expect(unencodable("emoji 😀", "windows-1252")).toBe("😀");
    expect(unencodable("tick ✓", "utf-8")).toBeNull();
    expect(unencodable("tick ✓", "utf-16le")).toBeNull();
  });

  it("labels every encoding the shell can report", () => {
    expect(Object.keys(ENCODING_LABEL)).toEqual(["utf-8", "utf-8-bom", "utf-16le", "utf-16be", "windows-1252"]);
  });
});
