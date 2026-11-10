// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

// What the frontend knows about document encodings: the names the shell
// reports, how the status bar labels them, and which characters a legacy
// encoding cannot hold, so a save that would lose text is stopped before
// it reaches the disk. The shell decodes and encodes the bytes themselves.

export type Encoding = "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" | "windows-1252";

export const ENCODING_LABEL: Record<Encoding, string> = {
  "utf-8": "UTF-8",
  "utf-8-bom": "UTF-8 BOM",
  "utf-16le": "UTF-16 LE",
  "utf-16be": "UTF-16 BE",
  "windows-1252": "Windows-1252",
};

// What Windows-1252 writes beyond Latin-1: the 27 characters at 0x80–0x9F.
// (The five C1 controls in that range are below U+0100 and pass anyway.)
const WINDOWS_1252_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

/** The first character `text` holds that `encoding` cannot write, if any. */
export function unencodable(text: string, encoding: Encoding): string | null {
  if (encoding !== "windows-1252") return null;
  for (const ch of text) {
    if ((ch.codePointAt(0) ?? 0) >= 0x100 && !WINDOWS_1252_EXTRA.has(ch)) return ch;
  }
  return null;
}
