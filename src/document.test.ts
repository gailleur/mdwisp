// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Gailleur Labs. All rights reserved.

import { describe, expect, it } from "vitest";

import { denormalise, normalise, untitledName } from "./document";

describe("line-ending handling", () => {
  it("normalises CRLF to LF and remembers it", () => {
    const b = normalise("a\r\nb\r\n");
    expect(b.text).toBe("a\nb\n");
    expect(b.eol).toBe("\r\n");
    expect(b.trailingNewline).toBe(true);
  });

  it("round-trips CRLF files", () => {
    const raw = "# T\r\n\r\ntext\r\n";
    const b = normalise(raw);
    expect(denormalise(b.text, b)).toBe(raw);
  });

  it("preserves the absence of a trailing newline", () => {
    const raw = "no newline";
    const b = normalise(raw);
    expect(b.trailingNewline).toBe(false);
    expect(denormalise("edited\n", b)).toBe("edited");
  });

  it("adds a trailing newline when the original had one", () => {
    const b = normalise("x\n");
    expect(denormalise("y", b)).toBe("y\n");
  });

  it("treats an empty file as LF with trailing newline convention", () => {
    const b = normalise("");
    expect(b.eol).toBe("\n");
    expect(denormalise("", b)).toBe("");
  });
});

describe("untitledName", () => {
  it("numbers from the second document", () => {
    expect(untitledName(1)).toBe("Untitled.md");
    expect(untitledName(3)).toBe("Untitled 3.md");
  });
});
