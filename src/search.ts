// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

// Find in folder: the search side of the files sidebar. A field at the
// top, the matching lines below, grouped by file. The shell does the
// searching and hands back one file at a time, so results appear while the
// folder is still being read; typing again replaces the search under way.

export interface SearchHit {
  /** 1-based line in the file. */
  line: number;
  /** The matching line, trimmed (a long line is a window around the match). */
  text: string;
}

export interface SearchFile {
  path: string;
  hits: SearchHit[];
}

export interface SearchSummary {
  files: number;
  hits: number;
  /** A limit stopped the search before the whole folder was read. */
  truncated: boolean;
  /** A newer search replaced this one. */
  cancelled: boolean;
}

export interface SearchHost {
  /** Searches the folder; `onFile` gets each file with matches as it is found. */
  search: (root: string, query: string, onFile: (file: SearchFile) => void) => Promise<SearchSummary>;
  /** Stops the search under way, if any. */
  cancel: () => void;
  /** A matching line was chosen. */
  openHit: (path: string, hit: SearchHit, query: string) => void;
  /** Escape in the field: back to the file tree. */
  exit: () => void;
}

/** Shortest query worth a walk through the folder. */
export const MIN_QUERY = 2;
const TYPING_PAUSE_MS = 250;

/** `text` with every occurrence of `query` (ignoring case) wrapped in <mark>. */
export function markMatches(text: string, query: string): DocumentFragment {
  const out = document.createDocumentFragment();
  const needle = query.toLowerCase();
  const hay = text.toLowerCase();
  // Lower-casing can change the length of a few characters; then the
  // offsets would not line up, and plain text is the honest answer.
  if (!needle || hay.length !== text.length) {
    out.append(text);
    return out;
  }
  let from = 0;
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, from)) {
    if (at > from) out.append(text.slice(from, at));
    const mark = document.createElement("mark");
    mark.className = "search__match";
    mark.textContent = text.slice(at, at + needle.length);
    out.append(mark);
    from = at + needle.length;
  }
  if (from < text.length) out.append(text.slice(from));
  return out;
}

/** How far into a line a match may sit before the line is shown from just before it. */
const LEAD_IN = 18;
const LEAD_KEPT = 12;

/**
 * The line as listed in a narrow panel: when the match sits far to the
 * right, the text starts a few words before it instead, so the match is
 * what shows rather than what is cut off.
 */
export function leadIn(text: string, query: string): string {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (!query || at <= LEAD_IN) return text;
  let start = at - LEAD_KEPT;
  const space = text.indexOf(" ", start);
  if (space >= 0 && space < at) start = space + 1;
  return `…${text.slice(start)}`;
}

/** File name and containing folder of `path`, the folder relative to `root`. */
export function splitPath(root: string, path: string): { name: string; dir: string } {
  const sep = path.includes("\\") && !path.includes("/") ? "\\" : "/";
  const base = root.endsWith(sep) ? root.slice(0, -1) : root;
  const relative = base && path.startsWith(base + sep) ? path.slice(base.length + 1) : path;
  const cut = relative.lastIndexOf(sep);
  return cut < 0 ? { name: relative, dir: "" } : { name: relative.slice(cut + 1), dir: relative.slice(0, cut) };
}

export class SearchView {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly status: HTMLElement;
  private readonly results: HTMLElement;
  private root: string | null = null;
  /** The query whose results are on screen (or arriving). */
  private shownQuery = "";
  /** Counts searches, so a late answer to an old one is dropped. */
  private run = 0;
  private timer: number | null = null;
  private files = 0;
  private hits = 0;
  /** The summary of the search on screen, once it has arrived. */
  private summary: SearchSummary | null = null;

  constructor(private readonly host: SearchHost) {
    this.element = document.createElement("div");
    this.element.className = "search";
    this.element.hidden = true;

    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "search__input";
    this.input.placeholder = "find in folder";
    this.input.spellcheck = false;
    this.input.autocomplete = "off";
    this.input.setAttribute("aria-label", "Find in folder");

    this.status = document.createElement("p");
    this.status.className = "search__status";
    this.status.setAttribute("role", "status");

    this.results = document.createElement("div");
    this.results.className = "search__results";
    this.results.setAttribute("role", "tree");
    this.results.setAttribute("aria-label", "Search results");

    this.input.addEventListener("input", () => this.schedule());
    this.input.addEventListener("keydown", (event) => {
      // Enter that ends an input-method composition is not a command.
      if (event.isComposing) return;
      if (event.key === "Enter") this.start(true);
      else if (event.key === "Escape") this.host.exit();
      else if (event.key === "ArrowDown") this.rows()[0]?.focus();
      else return;
      event.preventDefault();
    });
    this.results.addEventListener("click", (event) => {
      const row = (event.target as HTMLElement).closest<HTMLButtonElement>(".search__row");
      if (row) this.act(row);
    });
    this.results.addEventListener("keydown", (event) => this.onKey(event));

    this.element.append(this.input, this.status, this.results);
  }

  get query(): string {
    return this.input.value.trim();
  }

  /** The folder to search, or none. Results of another folder are dropped. */
  setRoot(root: string | null): void {
    if (root === this.root) return;
    this.root = root;
    this.clear();
    this.host.cancel();
  }

  setOpen(open: boolean): void {
    this.element.hidden = !open;
  }

  /** Puts the cursor in the field, with `text` (a selection, say) as the query. */
  focus(text?: string): void {
    if (text && text !== this.query) {
      this.input.value = text;
      this.start();
    }
    this.input.focus();
    this.input.select();
  }

  // --- internals -----------------------------------------------------------

  /** Drops the results on screen and disowns the search under way. */
  private clear(): void {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = null;
    this.run += 1;
    this.shownQuery = "";
    this.files = 0;
    this.hits = 0;
    this.summary = null;
    this.results.replaceChildren();
    this.status.textContent = "";
  }

  private schedule(): void {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.start(), TYPING_PAUSE_MS);
  }

  /** Searches for what is in the field; `force` repeats an unchanged query. */
  private start(force = false): void {
    const query = this.query;
    if (!force && query === this.shownQuery) {
      if (this.timer) window.clearTimeout(this.timer);
      this.timer = null;
      return;
    }
    this.clear();
    if (!this.root || query.length < MIN_QUERY) {
      // No new search will replace the one under way: stop it explicitly.
      this.host.cancel();
      this.status.textContent = query ? `type ${MIN_QUERY} letters or more` : "";
      return;
    }
    this.shownQuery = query;
    const run = this.run;
    const root = this.root;
    this.status.textContent = "searching…";
    this.host
      .search(root, query, (file) => {
        if (run === this.run) this.addFile(root, file, query);
      })
      .then((summary) => {
        if (run !== this.run || summary.cancelled) return;
        this.summary = summary;
        this.status.textContent = this.describe();
      })
      .catch((error: unknown) => {
        if (run !== this.run) return;
        this.shownQuery = "";
        this.status.textContent = `search failed: ${error instanceof Error ? error.message : String(error)}`;
      });
  }

  /**
   * The status line. Files and the summary travel separately and may
   * arrive in either order, so the totals are the shell's once it has
   * given them and a running count until then.
   */
  private describe(): string {
    const hits = this.summary?.hits ?? this.hits;
    const fileCount = this.summary?.files ?? this.files;
    if (hits === 0) return this.summary ? "no results" : "searching…";
    const lines = `${hits} ${hits === 1 ? "line" : "lines"}`;
    const files = `${fileCount} ${fileCount === 1 ? "file" : "files"}`;
    if (!this.summary) return `searching… ${lines} in ${files}`;
    return this.summary.truncated ? `first ${lines} in ${files}; narrow the search for the rest` : `${lines} in ${files}`;
  }

  private addFile(root: string, file: SearchFile, query: string): void {
    this.files += 1;
    this.hits += file.hits.length;
    this.status.textContent = this.describe();

    const { name, dir } = splitPath(root, file.path);
    const group = document.createElement("div");
    group.className = "search__file";
    group.setAttribute("role", "treeitem");
    group.setAttribute("aria-expanded", "true");

    const head = document.createElement("button");
    head.type = "button";
    head.className = "search__row search__row--file";
    head.tabIndex = -1;
    head.title = file.path;
    head.setAttribute("aria-expanded", "true");
    const mark = document.createElement("span");
    mark.className = "search__mark";
    mark.textContent = "›";
    const label = document.createElement("span");
    label.className = "search__name";
    label.textContent = name;
    const where = document.createElement("span");
    where.className = "search__dir";
    where.textContent = dir;
    const count = document.createElement("span");
    count.className = "search__count";
    count.textContent = String(file.hits.length);
    head.append(mark, label, where, count);

    const lines = document.createElement("div");
    lines.className = "search__hits";
    lines.setAttribute("role", "group");
    for (const hit of file.hits) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "search__row search__row--hit";
      row.tabIndex = -1;
      row.dataset["path"] = file.path;
      row.dataset["line"] = String(hit.line);
      row.dataset["text"] = hit.text;
      row.title = `${name}:${hit.line}\n${hit.text}`;
      row.setAttribute("role", "treeitem");
      const number = document.createElement("span");
      number.className = "search__line";
      number.textContent = String(hit.line);
      const text = document.createElement("span");
      text.className = "search__text";
      text.appendChild(markMatches(leadIn(hit.text, query), query));
      row.append(number, text);
      lines.appendChild(row);
    }
    group.append(head, lines);
    this.results.appendChild(group);
    // One row is in the tab order, so Tab from the field reaches the results.
    if (this.files === 1) head.tabIndex = 0;
  }

  /** The rows that are on screen: file heads, and the lines of open files. */
  private rows(): HTMLButtonElement[] {
    return Array.from(this.results.querySelectorAll<HTMLButtonElement>(".search__row")).filter(
      (row) => !row.closest<HTMLElement>(".search__hits")?.hidden,
    );
  }

  private toggle(head: HTMLButtonElement, open?: boolean): void {
    const group = head.parentElement;
    const lines = group?.querySelector<HTMLElement>(".search__hits");
    if (!group || !lines) return;
    const next = open ?? lines.hidden;
    lines.hidden = !next;
    head.setAttribute("aria-expanded", next ? "true" : "false");
    group.setAttribute("aria-expanded", next ? "true" : "false");
  }

  private act(row: HTMLButtonElement): void {
    if (row.classList.contains("search__row--file")) {
      this.toggle(row);
      return;
    }
    for (const other of this.results.querySelectorAll(".search__row--active")) other.classList.remove("search__row--active");
    row.classList.add("search__row--active");
    this.host.openHit(row.dataset["path"] ?? "", { line: Number(row.dataset["line"]), text: row.dataset["text"] ?? "" }, this.shownQuery);
  }

  private onKey(event: KeyboardEvent): void {
    const row = (event.target as HTMLElement).closest<HTMLButtonElement>(".search__row");
    if (!row) return;
    const rows = this.rows();
    const index = rows.indexOf(row);
    const focus = (target: HTMLButtonElement | undefined) => {
      if (!target) return;
      for (const r of rows) r.tabIndex = r === target ? 0 : -1;
      target.focus();
    };
    const isFile = row.classList.contains("search__row--file");
    const open = row.getAttribute("aria-expanded") === "true";
    switch (event.key) {
      case "ArrowDown":
        focus(rows[index + 1]);
        break;
      case "ArrowUp":
        if (index === 0) this.input.focus();
        else focus(rows[index - 1]);
        break;
      case "ArrowRight":
        if (isFile && !open) this.toggle(row, true);
        else if (isFile) focus(rows[index + 1]);
        break;
      case "ArrowLeft":
        if (isFile) this.toggle(row, false);
        else focus(row.closest(".search__file")?.querySelector<HTMLButtonElement>(".search__row--file") ?? undefined);
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
      case "Escape":
        this.input.focus();
        break;
      default:
        return;
    }
    event.preventDefault();
  }
}
