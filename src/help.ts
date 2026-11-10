// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

// The in-app help panel: every shortcut, what each mode does, and the
// limits worth knowing before you rely on the app. Fully offline — there is
// nothing here a network could add.

export interface HelpRow {
  keys: string;
  what: string;
}

export interface HelpSection {
  title: string;
  rows?: HelpRow[];
  notes?: string[];
}

/** Rewrites Mac key glyphs for other platforms: ⌘⇧S → Ctrl+Shift+S. */
export function keysFor(keys: string, isMac: boolean): string {
  if (isMac) return keys;
  return keys.replace(/⌘/g, "Ctrl+").replace(/⇧/g, "Shift+").replace(/⌥/g, "Alt+");
}

export function helpSections(isMac: boolean): HelpSection[] {
  const k = (keys: string, what: string): HelpRow => ({ keys: keysFor(keys, isMac), what });
  return [
    {
      title: "files",
      rows: [
        k("⌘N", "new document"),
        k("⌘O", "open… (or drop .md files on the window)"),
        k("⌘⇧O", "open folder… in the files sidebar"),
        k("⌘P", "go to file: type part of a name to jump to a Markdown file of the open folder"),
        k("⌘⇧F", "find in folder: search the text of every Markdown file in it"),
        k("⌘S", "save"),
        k("⌘⇧S", "save as…"),
        k("⌘R", "reload from disk"),
        k("⌘⌥P", "print"),
        k("⌘⇧E", "export the reading view as PDF (asks where to save)"),
        k("⌘W", "close tab"),
      ],
      notes: [
        "Autosave writes a second after each change. Off by default; the status bar shows “autosave on/off” and clicking it toggles, as does File ▸ Autosave, which is ticked while on.",
        "A file changed on disk reloads by itself; if you have unsaved edits a banner lets you keep yours or take the disk copy.",
        "Front matter (a YAML `---`, TOML `+++` or JSON block at the top, as Hugo, Jekyll and Obsidian write it) is shown as a collapsed panel in reading view and as a plain text field above the editor. It is saved back exactly as it was, whatever you edit below it. Source view shows it as text, which is where to add or remove one.",
        "File ▸ Use mdwisp for .md Files makes this the default Markdown app and is ticked while it is. The first launch offers it once; it is never changed without asking.",
        "Print and Export PDF put only the document on paper, with half-inch margins; the outline sidebar and the app chrome stay on screen.",
        "App Store build: the app can only see files you open. When a document shows images from its folder, a banner offers to grant that folder; the grant is remembered.",
        "Go to file lists the open documents first, then the folder's Markdown files; letters match in order, so “spc” finds spec.md and “docs/sp” looks inside docs. Hidden folders and node_modules are left out.",
        "Find in folder turns the files sidebar into a search: results appear as you type, grouped by file. Click a line to open the document at that place; the match is shown through the find bar, so ⌘G steps on. The search is literal and ignores case. Esc, or the magnifier in the sidebar's header, returns to the files.",
        "The app starts with the documents that were open when it quit, each in the same view and place. View ▸ Reopen Documents at Launch turns that off.",
      ],
    },
    {
      title: "view",
      rows: [
        k("⌘⇧P", "command palette: every command, by name"),
        k("⌘1", "reading — rendered, read-only"),
        k("⌘2", "editor — WYSIWYG"),
        k("⌘3", "source — raw Markdown"),
        k("⌘⌥E", "files sidebar (or the “▤ files” button); click a Markdown file to open it"),
        k("⌘⌥S", "outline sidebar (or the “☰ outline” button); click a heading to jump"),
        k("⌘F", "find (⌘G next, ⌘⇧G previous)"),
        k("⌘⌥F", "replace, in the editor and source"),
        k("⌘⇧D", "theme: auto → light → dark"),
        k("⌘= ⌘- ⌘0", "zoom in, out, reset"),
        k("⌘/", "this help"),
      ],
      notes: [
        "The status bar, left to right: files switch, outline switch, mode (click to cycle), block type, path, then autosave switch, word count and reading time at 238 words per minute, line endings, theme. Switches are green while on.",
        "View ▸ Files Sidebar, Outline Sidebar, Remote Images, Preview Tabs and Reopen Documents at Launch are ticked while on.",
        "The files sidebar shows one folder: folders open on a click, Markdown files open as tabs, other files are listed greyed out. Hidden files are not shown. The open folder and the document in front are kept in step, and the folder is remembered for the next launch; × in its header closes it.",
        "A single click on a file in the sidebar opens it as a preview: a tab in italics that the next click replaces, so browsing does not fill the tab bar. Double-click the file or the tab, edit the document, or drag the tab, and it stays. View ▸ Preview Tabs turns previews off.",
        "Drag a tab sideways to change the order of the tabs.",
        keysFor(`The find bar ignores case and takes the text literally until you switch on Aa (match case), ab (whole word) or .* (regular expression); ${isMac ? "⌘⌥C, ⌘⌥W and ⌘⌥R" : "Alt+C, Alt+W and Alt+R"} do the same from the bar. ▸ at its left, or ⌘⌥F, shows the replace field: Enter replaces the current match and moves on, ⌘Enter replaces them all as one change that a single undo reverts. With .* on, $1 and $<name> in the replacement insert what the expression captured.`, isMac),
        "Drag a sidebar's right edge to resize it; the width is remembered. Double-click the edge to restore the default.",
        "On macOS the tab bar is the title bar: drag the window by the empty space at its right end, which tabs never cover. Double-click it to zoom the window.",
      ],
    },
    {
      title: "format (editor and source)",
      rows: [
        k("⌘⌥0", "paragraph"),
        k("⌘⌥1 … ⌘⌥6", "heading 1 … 6"),
        k("⌘B  ⌘I", "bold, italic"),
        k("⌘⇧X  ⌘E", "strikethrough, inline code"),
        k("⌘K", "link (asks for the URL)"),
        k("⌘⇧7  ⌘⇧9", "bulleted, numbered list"),
        k("⌘⇧L", "task list"),
        k("⌘⇧.  ⌘⇧C", "quote, code block"),
      ],
      notes: [
        "The block control in the status bar (“paragraph ▾”) opens the same list.",
        "In the editor, Markdown shorthand works as you type: “## ”, “- ”, “1. ”, “> ”, “```”.",
      ],
    },
    {
      title: "limits",
      notes: [
        "Math ($…$) and Mermaid diagrams render in reading view only. In the editor and source they are plain text you edit by hand.",
        "The editor saves normalised Markdown: “-” bullets, “*” emphasis, fenced code. A document you did not change is written back byte for byte.",
        "Relative images load from the document's folder and its subfolders, nowhere else.",
        "The app never connects on its own: no automatic update checks, no telemetry. Help ▸ Check for Updates… (also linked from the About box) fetches one small file from mdwisp.com when you choose it and reports the result in a banner at the top; remote images load only after you allow them: for one document from its banner, or everywhere with View ▸ Remote Images.",
        "Installing an update relaunches the app as you left it: the same documents, in the same view and place, with the same zoom. Unsaved ones are asked about first.",
        "HTML inside documents is sanitised: scripts, forms, event handlers and external styles are removed.",
        "Find and replace inside the editor need a recent webview. Reading and source modes always find; source mode always replaces.",
        "In the reading view and the editor a match stays within one run of text, so it cannot span bold and plain words, and a regular expression sees one run at a time (^ and $ are its ends). For patterns across lines, use source mode.",
        "Closing a tab or the window with unsaved changes asks whether to save, discard or cancel; Save on an unsaved document opens the Save As dialog.",
      ],
    },
  ];
}

export interface HelpPanel {
  readonly element: HTMLElement;
  close(): void;
}

export const HOMEPAGE = "https://gailleur.com";
export const REPOSITORY = "https://github.com/gailleur/mdwisp";

export interface HelpOptions {
  onClose?: () => void;
  /** Opens a URL in the system browser. The panel never navigates itself. */
  openLink?: (url: string) => void;
}

export function openHelp(isMac: boolean, options: HelpOptions = {}): HelpPanel {
  const { onClose, openLink } = options;
  const element = document.createElement("div");
  element.className = "help";
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-modal", "true");
  element.setAttribute("aria-label", "mdwisp help");

  const panel = document.createElement("div");
  panel.className = "help__panel";

  const head = document.createElement("div");
  head.className = "help__head";
  const title = document.createElement("span");
  title.className = "help__title";
  title.textContent = "mdwisp help";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "help__close";
  closeButton.setAttribute("aria-label", "Close");
  closeButton.textContent = "×";
  head.append(title, closeButton);
  panel.appendChild(head);

  for (const section of helpSections(isMac)) {
    const block = document.createElement("section");
    block.className = "help__section";
    const h = document.createElement("h3");
    h.textContent = section.title;
    block.appendChild(h);
    if (section.rows) {
      const rows = document.createElement("dl");
      rows.className = "help__rows";
      for (const row of section.rows) {
        const dt = document.createElement("dt");
        const kbd = document.createElement("kbd");
        kbd.textContent = row.keys;
        dt.appendChild(kbd);
        const dd = document.createElement("dd");
        dd.textContent = row.what;
        rows.append(dt, dd);
      }
      block.appendChild(rows);
    }
    if (section.notes) {
      const list = document.createElement("ul");
      list.className = "help__notes";
      for (const note of section.notes) {
        const li = document.createElement("li");
        li.textContent = note;
        list.appendChild(li);
      }
      block.appendChild(list);
    }
    panel.appendChild(block);
  }

  // Footer links hand the URL to the shell, which opens the system browser.
  const foot = document.createElement("p");
  foot.className = "help__foot";
  const link = (label: string, url: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.textContent = label;
    a.addEventListener("click", (event) => {
      event.preventDefault();
      openLink?.(url);
    });
    return a;
  };
  foot.append(
    "© 2026 ",
    link("Gailleur Labs", HOMEPAGE),
    " · Apache License 2.0 · ",
    link("github.com/gailleur/mdwisp", REPOSITORY),
  );
  panel.appendChild(foot);
  element.appendChild(panel);

  const close = () => {
    if (!element.isConnected) return;
    element.remove();
    document.removeEventListener("keydown", onKey, true);
    onClose?.();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };
  closeButton.addEventListener("click", close);
  element.addEventListener("mousedown", (event) => {
    if (event.target === element) close();
  });
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(element);
  closeButton.focus();

  return { element, close };
}
