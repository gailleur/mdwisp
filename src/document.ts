// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Gailleur. All rights reserved.

// Pure helpers for the document model. Kept free of DOM so they are trivially
// unit-tested.

export type Eol = "\n" | "\r\n";

export interface TextBaseline {
  /** Text as loaded, normalised to LF. */
  text: string;
  eol: Eol;
  trailingNewline: boolean;
}

export function detectEol(raw: string): Eol {
  return raw.includes("\r\n") ? "\r\n" : "\n";
}

export function normalise(raw: string): TextBaseline {
  return {
    text: raw.replace(/\r\n/g, "\n"),
    eol: detectEol(raw),
    trailingNewline: raw.length === 0 || raw.endsWith("\n"),
  };
}

/** Converts editor text back to the file's conventions (line endings, final newline). */
export function denormalise(text: string, baseline: Pick<TextBaseline, "eol" | "trailingNewline">): string {
  let out = text;
  if (baseline.trailingNewline && out.length > 0 && !out.endsWith("\n")) out += "\n";
  if (!baseline.trailingNewline && out.endsWith("\n")) out = out.replace(/\n+$/, "");
  return baseline.eol === "\r\n" ? out.replace(/\n/g, "\r\n") : out;
}

export function untitledName(index: number): string {
  return index <= 1 ? "Untitled.md" : `Untitled ${index}.md`;
}
