// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

// Every action the app offers, as the command palette lists it. The ids are
// the menu ids: the native menu, the keyboard and the palette all end up in
// the same handlers. Ids starting with "fmt-" are Format actions and carry
// their kind after the dash.

export type CommandGroup = "File" | "Edit" | "Format" | "View" | "Help";

export interface Command {
  id: string;
  /** The menu the command lives in; shown beside its title. */
  group: CommandGroup;
  title: string;
  /** Shortcut in Mac glyphs; `keysFor` spells it out elsewhere. */
  keys?: string;
}

export const COMMANDS = [
  { id: "new", group: "File", title: "New", keys: "⌘N" },
  { id: "open", group: "File", title: "Open…", keys: "⌘O" },
  { id: "open-folder", group: "File", title: "Open Folder…", keys: "⌘⇧O" },
  { id: "quick-open", group: "File", title: "Go to File…", keys: "⌘P" },
  { id: "save", group: "File", title: "Save", keys: "⌘S" },
  { id: "save-as", group: "File", title: "Save As…", keys: "⌘⇧S" },
  { id: "autosave", group: "File", title: "Toggle Autosave" },
  { id: "reload", group: "File", title: "Reload from Disk", keys: "⌘R" },
  { id: "print", group: "File", title: "Print…", keys: "⌘⌥P" },
  { id: "export-pdf", group: "File", title: "Export PDF…", keys: "⌘⇧E" },
  { id: "close-tab", group: "File", title: "Close Tab", keys: "⌘W" },
  { id: "default-app", group: "File", title: "Use mdwisp for .md Files" },

  { id: "find", group: "Edit", title: "Find…", keys: "⌘F" },
  { id: "find-next", group: "Edit", title: "Find Next", keys: "⌘G" },
  { id: "find-prev", group: "Edit", title: "Find Previous", keys: "⌘⇧G" },
  { id: "replace", group: "Edit", title: "Replace…", keys: "⌘⌥F" },
  { id: "search-folder", group: "Edit", title: "Find in Folder…", keys: "⌘⇧F" },

  { id: "fmt-paragraph", group: "Format", title: "Paragraph", keys: "⌘⌥0" },
  { id: "fmt-h1", group: "Format", title: "Heading 1", keys: "⌘⌥1" },
  { id: "fmt-h2", group: "Format", title: "Heading 2", keys: "⌘⌥2" },
  { id: "fmt-h3", group: "Format", title: "Heading 3", keys: "⌘⌥3" },
  { id: "fmt-h4", group: "Format", title: "Heading 4", keys: "⌘⌥4" },
  { id: "fmt-h5", group: "Format", title: "Heading 5", keys: "⌘⌥5" },
  { id: "fmt-h6", group: "Format", title: "Heading 6", keys: "⌘⌥6" },
  { id: "fmt-bold", group: "Format", title: "Bold", keys: "⌘B" },
  { id: "fmt-italic", group: "Format", title: "Italic", keys: "⌘I" },
  { id: "fmt-strike", group: "Format", title: "Strikethrough", keys: "⌘⇧X" },
  { id: "fmt-code", group: "Format", title: "Inline Code", keys: "⌘E" },
  { id: "fmt-link", group: "Format", title: "Link…", keys: "⌘K" },
  { id: "fmt-bullet", group: "Format", title: "Bulleted List", keys: "⌘⇧7" },
  { id: "fmt-ordered", group: "Format", title: "Numbered List", keys: "⌘⇧9" },
  { id: "fmt-task", group: "Format", title: "Task List", keys: "⌘⇧L" },
  { id: "fmt-quote", group: "Format", title: "Quote", keys: "⌘⇧." },
  { id: "fmt-codeblock", group: "Format", title: "Code Block", keys: "⌘⇧C" },
  { id: "fmt-hr", group: "Format", title: "Horizontal Rule" },
  { id: "fmt-table", group: "Format", title: "Table" },

  { id: "mode-view", group: "View", title: "Reading View", keys: "⌘1" },
  { id: "mode-wysiwyg", group: "View", title: "Editor View", keys: "⌘2" },
  { id: "mode-source", group: "View", title: "Source View", keys: "⌘3" },
  { id: "files", group: "View", title: "Toggle Files Sidebar", keys: "⌘⌥E" },
  { id: "outline", group: "View", title: "Toggle Outline Sidebar", keys: "⌘⌥S" },
  { id: "theme", group: "View", title: "Cycle Theme", keys: "⌘⇧D" },
  { id: "remote-images", group: "View", title: "Toggle Remote Images" },
  { id: "preview-tabs", group: "View", title: "Toggle Preview Tabs" },
  { id: "restore-session", group: "View", title: "Toggle Reopen Documents at Launch" },
  { id: "zoom-in", group: "View", title: "Zoom In", keys: "⌘=" },
  { id: "zoom-out", group: "View", title: "Zoom Out", keys: "⌘-" },
  { id: "zoom-reset", group: "View", title: "Actual Size", keys: "⌘0" },

  { id: "help", group: "Help", title: "mdwisp Help", keys: "⌘/" },
  { id: "check-updates", group: "Help", title: "Check for Updates…" },
] as const satisfies readonly Command[];

export type CommandId = (typeof COMMANDS)[number]["id"];

/** Ids handled by a plain action; the rest are Format actions. */
export type ActionId = Exclude<CommandId, `fmt-${string}`>;

export const FORMAT_PREFIX = "fmt-";

/** Opens the palette itself; a menu item and a shortcut, not a palette entry. */
export const PALETTE_ID = "command-palette";
export const PALETTE_KEYS = "⌘⇧P";
