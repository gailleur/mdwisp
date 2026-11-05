// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

// From a line of Markdown source to the place it ended up in a rendered
// document. "Find in folder" reports source lines; the reading view and the
// editor show rendered blocks. Among the places where the search text
// occurs in the rendering, this picks the one that came from that line.

const BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote, dt, dd, figcaption";

/**
 * A source line reduced to the words a reader sees: list markers, heading
 * marks, emphasis, link targets and HTML tags removed, whitespace
 * collapsed, lower-case. Rendered text is reduced the same way so the two
 * can be compared.
 */
export function plainText(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // [label](target), ![alt](src)
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s*(?:>\s*)*(?:#{1,6}\s+|(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?/, "")
    .replace(/[*_~`|\\[\]]/g, "")
    .replace(/…/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Index in `ranges` (occurrences of the search text in a rendered document,
 * in document order) of the one that renders `line`, the source line that
 * matched. When no block can be recognised, falls back to the occurrence
 * at the same relative depth as `lineNumber` of `lineCount`.
 */
export function rangeForLine(ranges: Range[], line: string, lineNumber: number, lineCount: number): number {
  if (ranges.length === 0) return -1;
  const wanted = plainText(line);
  if (wanted) {
    let partial = -1;
    for (let i = 0; i < ranges.length; i += 1) {
      const node = ranges[i]!.startContainer;
      const element = node instanceof Element ? node : node.parentElement;
      const block = plainText(element?.closest(BLOCKS)?.textContent ?? element?.textContent ?? "");
      if (!block) continue;
      // A paragraph spans several source lines; a long line is cut to a window.
      if (block.includes(wanted)) return i;
      if (partial < 0 && wanted.length >= 8 && wanted.includes(block)) partial = i;
    }
    if (partial >= 0) return partial;
  }
  const depth = lineCount > 1 ? (lineNumber - 1) / (lineCount - 1) : 0;
  return Math.min(ranges.length - 1, Math.max(0, Math.round(depth * (ranges.length - 1))));
}
