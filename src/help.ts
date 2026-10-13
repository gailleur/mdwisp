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
        k("⌘S", "save"),
        k("⌘⇧S", "save as…"),
        k("⌘R", "reload from disk"),
        k("⌘P", "print"),
        k("⌘⇧E", "export PDF of the reading view, no dialog"),
        k("⌘W", "close tab"),
      ],
      notes: [
        "File ▸ Toggle Autosave writes a second after each change. Off by default.",
        "A file changed on disk reloads by itself; if you have unsaved edits a banner lets you keep yours or take the disk copy.",
        "File ▸ Use mdwisp for .md Files makes this the default Markdown app. The first launch offers it once; it is never changed without asking.",
      ],
    },
    {
      title: "view",
      rows: [
        k("⌘1", "reading — rendered, read-only"),
        k("⌘2", "editor — WYSIWYG"),
        k("⌘3", "source — raw Markdown"),
        k("⌘⌥S", "outline sidebar; click a heading to jump"),
        k("⌘F", "find (⌘G next, ⌘⇧G previous)"),
        k("⌘⇧D", "theme: auto → light → dark"),
        k("⌘= ⌘- ⌘0", "zoom in, out, reset"),
        k("⌘/", "this help"),
      ],
      notes: ["The status bar shows mode, block type, path, word count and reading time at 238 words per minute."],
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
        "Remote images are the only network access, and View ▸ Toggle Remote Images turns them off. Nothing else ever leaves this machine: no update checks, no telemetry.",
        "HTML inside documents is sanitised: scripts, forms, event handlers and external styles are removed.",
        "Find inside the editor needs a recent webview. Reading and source modes always work.",
        "Closing the window closes every tab; you are asked about unsaved changes first.",
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
