// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Gailleur Labs. All rights reserved.

/** Formatting actions shared by the Format menu, shortcuts and the status bar. */
export type FormatKind =
  | "paragraph"
  | "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
  | "bold" | "italic" | "strike" | "code" | "link"
  | "bullet" | "ordered" | "task" | "quote" | "codeblock"
  | "hr" | "table";

/** What the status bar shows for the block at the cursor. */
export type BlockType = "paragraph" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "quote" | "list" | "task" | "codeblock" | "other";

export const BLOCK_LABEL: Record<BlockType, string> = {
  paragraph: "paragraph",
  h1: "heading 1",
  h2: "heading 2",
  h3: "heading 3",
  h4: "heading 4",
  h5: "heading 5",
  h6: "heading 6",
  quote: "quote",
  list: "list",
  task: "task list",
  codeblock: "code block",
  other: "block",
};

/** Block choices offered by the status-bar picker, in order. */
export const BLOCK_CHOICES: Array<[FormatKind, string, string]> = [
  ["paragraph", "Paragraph", "⌘⌥0"],
  ["h1", "Heading 1", "⌘⌥1"],
  ["h2", "Heading 2", "⌘⌥2"],
  ["h3", "Heading 3", "⌘⌥3"],
  ["h4", "Heading 4", "⌘⌥4"],
  ["quote", "Quote", "⌘⇧."],
  ["bullet", "Bulleted list", "⌘⇧7"],
  ["ordered", "Numbered list", "⌘⇧9"],
  ["task", "Task list", "⌘⇧L"],
  ["codeblock", "Code block", "⌘⇧C"],
];

export function headingLevel(kind: FormatKind): number | null {
  const match = /^h([1-6])$/.exec(kind);
  return match?.[1] ? Number(match[1]) : null;
}
