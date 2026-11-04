// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

// Files sidebar: the tree of one folder the user opened. Folders expand on
// demand, Markdown files open in a tab, everything else is listed but
// inert. The panel only draws what the host lists; the shell decides what
// a folder may show.
//
// Cost is proportional to what is on screen: a folder is listed when it is
// opened, and only open folders are watched, each on its own and without
// recursion. Nothing ever walks the whole tree, so a huge folder (a code
// checkout with its dependencies) opens as fast as a small one.

import { Sidebar } from "./sidebar";

export interface ExplorerEntry {
  name: string;
  path: string;
  kind: "dir" | "file";
  /** A file the app can open. Folders are never marked. */
  markdown: boolean;
}

export interface ExplorerRoot {
  path: string;
  name: string;
}

export interface ExplorerHost {
  /** Direct children of a folder, in any order. */
  list: (path: string) => Promise<ExplorerEntry[]>;
  /** Calls back when the folder's own entries change (not its subfolders'). Resolves to the stop function. */
  watch: (path: string, onChange: () => void) => Promise<() => void>;
  /** A Markdown file was chosen. */
  openFile: (path: string) => void;
  /** The "open folder" control in the empty panel. */
  pickFolder: () => void;
  /** The user closed the folder with the × control. */
  closeFolder: () => void;
  onResize?: (width: number) => void;
}

/** Folders first, then files, each group by name, case-insensitively. */
export function sortEntries(entries: ExplorerEntry[]): ExplorerEntry[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return collator.compare(a.name, b.name) || a.name.localeCompare(b.name);
  });
}

/** Folders between `root` and `path`, outermost first; empty if `path` is outside. */
export function ancestorsWithin(root: string, path: string): string[] {
  const sep = root.includes("\\") ? "\\" : "/";
  const base = root.endsWith(sep) ? root.slice(0, -1) : root;
  if (!path.startsWith(base + sep)) return [];
  const out: string[] = [];
  let cursor = base;
  const parts = path.slice(base.length + 1).split(sep);
  parts.pop(); // the file itself
  for (const part of parts) {
    cursor = `${cursor}${sep}${part}`;
    out.push(cursor);
  }
  return out;
}

export class Explorer extends Sidebar {
  private root: ExplorerRoot | null = null;
  private readonly name: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly tree: HTMLElement;
  private readonly children = new Map<string, ExplorerEntry[]>();
  private readonly expanded = new Set<string>();
  /** One watcher per open folder, keyed by its path. */
  private readonly watchers = new Map<string, Promise<() => void>>();
  private activePath: string | null = null;
  /** Serialises loads so a refresh never races an expand. */
  private pending: Promise<void> = Promise.resolve();
  private generation = 0;

  constructor(private readonly host: ExplorerHost) {
    super({ className: "explorer", label: "Files", onResize: host.onResize });

    const head = document.createElement("div");
    head.className = "explorer__head";
    this.name = document.createElement("span");
    this.name.className = "sidebar__title explorer__name";
    this.closeButton = document.createElement("button");
    this.closeButton.type = "button";
    this.closeButton.className = "explorer__close";
    this.closeButton.title = "Close folder";
    this.closeButton.setAttribute("aria-label", "Close folder");
    this.closeButton.textContent = "×";
    this.closeButton.addEventListener("click", () => host.closeFolder());
    head.append(this.name, this.closeButton);

    this.tree = document.createElement("div");
    this.tree.className = "explorer__tree";
    this.tree.addEventListener("click", (event) => this.onClick(event));
    this.tree.addEventListener("keydown", (event) => this.onKey(event));

    this.element.append(head, this.tree, this.handle);
    this.setHeader();
    this.render();
  }

  get folder(): ExplorerRoot | null {
    return this.root;
  }

  /** Shows a folder (or none). The tree is loaded fresh. */
  async setRoot(root: ExplorerRoot | null): Promise<void> {
    this.root = root;
    this.children.clear();
    for (const dir of [...this.expanded]) this.collapse(dir);
    this.generation += 1;
    this.setHeader();
    if (root) {
      this.expand(root.path);
      await this.load([root.path]);
    }
    this.render();
    if (this.activePath) await this.reveal(this.activePath);
  }

  /** Re-lists one open folder (it changed on disk). */
  async refresh(dir: string): Promise<void> {
    if (!this.expanded.has(dir)) return;
    await this.load([dir], true);
    this.render();
  }

  /**
   * Highlights `path` and, when it lies inside the folder, opens the folders
   * down to it. Null clears the highlight.
   */
  async reveal(path: string | null): Promise<void> {
    this.activePath = path;
    if (path && this.root) {
      const dirs = ancestorsWithin(this.root.path, path);
      const closed = dirs.filter((d) => !this.expanded.has(d));
      if (closed.length) {
        for (const d of closed) this.expand(d);
        await this.load(closed);
        this.render();
      }
    }
    this.markActive(true);
  }

  async toggle(dir: string): Promise<void> {
    if (this.expanded.has(dir)) {
      this.collapse(dir);
      this.render();
      return;
    }
    this.expand(dir);
    if (!this.children.has(dir)) await this.load([dir]);
    this.render();
  }

  // --- internals -----------------------------------------------------------

  /** Marks a folder open and starts watching its entries. */
  private expand(dir: string): void {
    if (this.expanded.has(dir)) return;
    this.expanded.add(dir);
    const watcher = this.host
      .watch(dir, () => void this.refresh(dir))
      .catch(() => () => undefined); // Unwatchable (gone, or not granted): shown once, not followed.
    this.watchers.set(dir, watcher);
  }

  /** Marks a folder closed and stops watching it. Its listing is kept for reopening. */
  private collapse(dir: string): void {
    if (!this.expanded.delete(dir)) return;
    const watcher = this.watchers.get(dir);
    this.watchers.delete(dir);
    if (watcher) void watcher.then((stop) => stop());
  }

  private setHeader(): void {
    this.name.textContent = this.root?.name ?? "files";
    this.name.title = this.root?.path ?? "";
    this.closeButton.hidden = this.root === null;
  }

  private load(dirs: string[], force = false): Promise<void> {
    const generation = this.generation;
    const run = async () => {
      for (const dir of dirs) {
        if (generation !== this.generation) return;
        if (!force && this.children.has(dir)) continue;
        try {
          this.children.set(dir, sortEntries(await this.host.list(dir)));
        } catch {
          // Gone or unreadable: show it empty and closed.
          this.children.delete(dir);
          this.collapse(dir);
        }
      }
    };
    this.pending = this.pending.then(run, run);
    return this.pending;
  }

  private render(): void {
    const scrollTop = this.tree.scrollTop;
    const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(".explorer__row")?.dataset["path"];
    this.tree.replaceChildren();
    if (!this.root) {
      const empty = document.createElement("p");
      empty.className = "explorer__empty";
      empty.textContent = "no folder open";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "explorer__open";
      open.textContent = "open folder…";
      open.addEventListener("click", () => this.host.pickFolder());
      this.tree.append(empty, open);
      return;
    }
    const list = this.renderGroup(this.root.path, 0);
    list.setAttribute("role", "tree");
    list.setAttribute("aria-label", this.root.name);
    this.tree.appendChild(list);
    this.markActive(false);
    this.tree.scrollTop = scrollTop;
    if (focused) this.rowFor(focused)?.focus();
  }

  private renderGroup(dir: string, depth: number): HTMLElement {
    const group = document.createElement("ul");
    group.className = "explorer__group";
    if (depth > 0) group.setAttribute("role", "group");
    const entries = this.children.get(dir) ?? [];
    if (entries.length === 0) {
      const item = document.createElement("li");
      item.className = "explorer__note";
      item.style.setProperty("--depth", String(depth));
      item.textContent = this.children.has(dir) ? "empty" : "…";
      group.appendChild(item);
      return group;
    }
    for (const entry of entries) {
      const item = document.createElement("li");
      item.setAttribute("role", "treeitem");
      const row = document.createElement("button");
      row.type = "button";
      row.className = "explorer__row";
      row.dataset["path"] = entry.path;
      row.dataset["kind"] = entry.kind;
      row.style.setProperty("--depth", String(depth));
      row.title = entry.path;
      row.tabIndex = -1;
      const mark = document.createElement("span");
      mark.className = "explorer__mark";
      const label = document.createElement("span");
      label.className = "explorer__label";
      label.textContent = entry.name;
      row.append(mark, label);
      if (entry.kind === "dir") {
        const open = this.expanded.has(entry.path);
        mark.textContent = "›";
        row.setAttribute("aria-expanded", open ? "true" : "false");
        item.setAttribute("aria-expanded", open ? "true" : "false");
        item.appendChild(row);
        if (open) item.appendChild(this.renderGroup(entry.path, depth + 1));
      } else {
        if (!entry.markdown) {
          row.classList.add("explorer__row--inert");
          row.setAttribute("aria-disabled", "true");
          row.title = `${entry.path}\nNot a Markdown file`;
        }
        item.appendChild(row);
      }
      group.appendChild(item);
    }
    return group;
  }

  private rows(): HTMLButtonElement[] {
    return Array.from(this.tree.querySelectorAll<HTMLButtonElement>(".explorer__row"));
  }

  private rowFor(path: string): HTMLButtonElement | null {
    return this.rows().find((row) => row.dataset["path"] === path) ?? null;
  }

  private markActive(scroll: boolean): void {
    let current: HTMLButtonElement | null = null;
    for (const row of this.rows()) {
      const active = row.dataset["path"] === this.activePath;
      row.classList.toggle("explorer__row--active", active);
      row.tabIndex = active ? 0 : -1;
      if (active) current = row;
    }
    if (!current) {
      const first = this.rows()[0];
      if (first) first.tabIndex = 0;
    } else if (scroll) {
      current.scrollIntoView({ block: "nearest" });
    }
  }

  private onClick(event: MouseEvent): void {
    const row = (event.target as HTMLElement).closest<HTMLButtonElement>(".explorer__row");
    if (row) this.act(row);
  }

  private act(row: HTMLButtonElement): void {
    const path = row.dataset["path"] ?? "";
    if (row.dataset["kind"] === "dir") void this.toggle(path);
    else if (row.getAttribute("aria-disabled") !== "true") this.host.openFile(path);
  }

  private onKey(event: KeyboardEvent): void {
    const row = (event.target as HTMLElement).closest<HTMLButtonElement>(".explorer__row");
    if (!row) return;
    const rows = this.rows();
    const index = rows.indexOf(row);
    const focus = (target: HTMLButtonElement | undefined) => {
      if (!target) return;
      for (const r of rows) r.tabIndex = r === target ? 0 : -1;
      target.focus();
    };
    const isDir = row.dataset["kind"] === "dir";
    const open = row.getAttribute("aria-expanded") === "true";
    switch (event.key) {
      case "ArrowDown":
        focus(rows[index + 1]);
        break;
      case "ArrowUp":
        focus(rows[index - 1]);
        break;
      case "ArrowRight":
        if (isDir && !open) void this.toggle(row.dataset["path"] ?? "");
        else if (isDir) focus(rows[index + 1]);
        break;
      case "ArrowLeft":
        if (isDir && open) {
          void this.toggle(row.dataset["path"] ?? "");
        } else {
          const parent = row.closest("ul")?.parentElement?.querySelector<HTMLButtonElement>(":scope > .explorer__row");
          if (parent) focus(parent);
        }
        break;
      case "Home":
        focus(rows[0]);
        break;
      case "End":
        focus(rows[rows.length - 1]);
        break;
      case "Enter":
      case " ":
        this.act(row);
        break;
      default:
        return;
    }
    event.preventDefault();
  }
}
