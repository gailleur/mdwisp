// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

import { denormalise, normalise, untitledName, type TextBaseline } from "./document";
import type { WysiwygEditor } from "./editor";
import type { BlockType, FormatKind } from "./format";
import { headingsFromMarkdown, type OutlineEntry } from "./outline";
import { renderDiagrams, renderDocument, type RenderContext } from "./render";
import type { SourceEditor } from "./source";
import type { EffectiveTheme } from "./theme";

// Editors are loaded on first use so a reading-only session never pays for
// ProseMirror or CodeMirror.
const loadWysiwyg = () => import("./editor");
const loadSource = () => import("./source");

export type Mode = "view" | "wysiwyg" | "source";

export interface LoadedDocument {
  path: string;
  name: string;
  dir: string;
  text: string;
  /** True in the App Store sandbox, where the folder may be unreadable. */
  sandboxed?: boolean;
}

export interface TabHost {
  load: (path: string) => Promise<LoadedDocument>;
  save: (path: string, text: string) => Promise<{ path: string; name: string; dir: string }>;
  pickSavePath: (defaultName: string) => Promise<string | null>;
  confirmDiscard: (message: string) => Promise<boolean>;
  watch: (path: string, onChange: () => void) => Promise<() => void>;
  assetUrl: (path: string) => string;
  theme: () => EffectiveTheme;
  allowRemoteImages: () => boolean;
  autosave: () => boolean;
  onActiveChange: (tab: Tab | null) => void;
  onTabStateChange: (tab: Tab) => void;
  /** Fires on every edit (not just dirty transitions). */
  onEdit?: (tab: Tab) => void;
  /** A document opened whose folder the app is not allowed to read. */
  onFolderUnreadable?: (tab: Tab) => void;
  onError: (message: string) => void;
}

export interface Tab {
  /** Null until an untitled document is saved. */
  path: string | null;
  name: string;
  dir: string | null;
  /** True in the App Store sandbox, where the folder may be unreadable. */
  sandboxed: boolean;
  title: string;
  mode: Mode;
  dirty: boolean;
  /** Set when the file changed on disk while there were unsaved edits. */
  conflict: boolean;
  button: HTMLButtonElement;
  panel: HTMLElement;
  article: HTMLElement;
  banner: HTMLElement;
  /** Current buffer (LF-normalised). Authoritative while in reading view. */
  text: string;
  baseline: TextBaseline;
  wysiwyg: WysiwygEditor | null;
  source: SourceEditor | null;
  unwatch: (() => void) | null;
  busy: Promise<void> | null;
  autosaveTimer: number | null;
}

export class Tabs {
  private readonly tabs: Tab[] = [];
  private active: Tab | null = null;
  private untitledCount = 0;

  constructor(
    private readonly strip: HTMLElement,
    private readonly viewer: HTMLElement,
    private readonly host: TabHost,
  ) {
    strip.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const button = target.closest<HTMLButtonElement>("button.tab");
      const tab = this.tabs.find((t) => t.button === button);
      if (!tab) return;
      if (target.closest(".tab__close")) void this.close(tab);
      else this.activate(tab);
    });
    strip.addEventListener("auxclick", (event) => {
      if (event.button !== 1) return;
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button.tab");
      const tab = this.tabs.find((t) => t.button === button);
      if (tab) void this.close(tab);
    });
  }

  get current(): Tab | null {
    return this.active;
  }

  get all(): readonly Tab[] {
    return this.tabs;
  }

  get hasUnsaved(): boolean {
    return this.tabs.some((t) => t.dirty);
  }

  /** Current buffer of a tab, from whichever surface is mounted. */
  textOf(tab: Tab): string {
    return this.currentText(tab);
  }

  /** Applies a Format action to the active editor; no-op in reading view. */
  format(kind: FormatKind, arg?: string): void {
    const tab = this.active;
    if (!tab) return;
    if (tab.mode === "wysiwyg") tab.wysiwyg?.format(kind, arg);
    else if (tab.mode === "source") tab.source?.format(kind, arg);
  }

  blockTypeOf(tab: Tab): BlockType | null {
    if (tab.mode === "wysiwyg") return tab.wysiwyg?.blockType() ?? null;
    if (tab.mode === "source") return tab.source?.blockType() ?? null;
    return null;
  }

  /** Headings of the tab in its current surface, each with a jump action. */
  outlineOf(tab: Tab): OutlineEntry[] {
    if (tab.mode === "wysiwyg" && tab.wysiwyg) {
      const editor = tab.wysiwyg;
      return editor.headings().map((h) => ({ level: h.level, text: h.text, go: () => editor.goTo(h.pos) }));
    }
    if (tab.mode === "source" && tab.source) {
      const source = tab.source;
      return headingsFromMarkdown(source.getText()).map((h) => ({ level: h.level, text: h.text, go: () => source.goToLine(h.line) }));
    }
    const viewer = this.viewer;
    return Array.from(tab.article.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")).map((el) => ({
      level: Number(el.tagName[1]),
      text: el.textContent?.trim() ?? "",
      go: () => {
        viewer.scrollTop = el.offsetTop - 24;
      },
    }));
  }

  /** Index of the outline entry the reader/cursor is currently in. */
  activeOutlineIndex(tab: Tab): number {
    if (tab.mode === "wysiwyg" && tab.wysiwyg) {
      const pos = tab.wysiwyg.cursorPos();
      return lastIndexWhere(tab.wysiwyg.headings(), (h) => h.pos <= pos);
    }
    if (tab.mode === "source" && tab.source) {
      const line = tab.source.cursorLine();
      return lastIndexWhere(headingsFromMarkdown(tab.source.getText()), (h) => h.line <= line);
    }
    const top = this.viewer.scrollTop + 40;
    const headings = Array.from(tab.article.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"));
    return lastIndexWhere(headings, (el) => el.offsetTop <= top);
  }

  async open(paths: string[]): Promise<void> {
    for (const path of paths) {
      const existing = this.tabs.find((t) => t.path === path);
      if (existing) {
        this.activate(existing);
        continue;
      }
      try {
        const doc = await this.host.load(path);
        const canonical = this.tabs.find((t) => t.path === doc.path);
        if (canonical) {
          this.activate(canonical);
          continue;
        }
        const tab = this.createTab(doc.path, doc.name, doc.dir, doc.text);
        tab.sandboxed = doc.sandboxed === true;
        this.mount(tab);
        await this.showMode(tab, "view", { restoreScroll: false });
        tab.unwatch = await this.host.watch(doc.path, () => void this.onDiskChange(tab));
      } catch (error) {
        this.host.onError(`${path}\n${describe(error)}`);
      }
    }
  }

  async newDocument(): Promise<void> {
    this.untitledCount += 1;
    const tab = this.createTab(null, untitledName(this.untitledCount), null, "");
    this.mount(tab);
    await this.showMode(tab, "wysiwyg", { restoreScroll: false });
  }

  activate(tab: Tab): void {
    if (this.active === tab) return;
    if (this.active) {
      this.active.button.classList.remove("tab--active");
      this.active.button.setAttribute("aria-selected", "false");
      this.active.panel.hidden = true;
    }
    this.active = tab;
    tab.button.classList.add("tab--active");
    tab.button.setAttribute("aria-selected", "true");
    tab.panel.hidden = false;
    tab.button.scrollIntoView({ block: "nearest", inline: "nearest" });
    this.host.onActiveChange(tab);
    this.focusEditor(tab);
  }

  /** Closes the tab, asking first if it has unsaved changes. Returns false if kept open. */
  async close(tab: Tab): Promise<boolean> {
    if (tab.dirty && !(await this.host.confirmDiscard(`Discard unsaved changes to “${tab.name}”?`))) {
      return false;
    }
    const index = this.tabs.indexOf(tab);
    if (index < 0) return true;
    tab.unwatch?.();
    if (tab.autosaveTimer) window.clearTimeout(tab.autosaveTimer);
    await this.teardownEditors(tab);
    tab.button.remove();
    tab.panel.remove();
    this.tabs.splice(index, 1);
    if (this.active === tab) {
      this.active = null;
      const next = this.tabs[index] ?? this.tabs[index - 1] ?? null;
      if (next) this.activate(next);
      else this.host.onActiveChange(null);
    }
    return true;
  }

  closeActive(): void {
    if (this.active) void this.close(this.active);
  }

  /** Returns true when every tab agreed to close (used before quitting). */
  async confirmCloseAll(): Promise<boolean> {
    for (const tab of [...this.tabs]) {
      if (!tab.dirty) continue;
      this.activate(tab);
      if (!(await this.host.confirmDiscard(`Discard unsaved changes to “${tab.name}”?`))) return false;
    }
    return true;
  }

  async setMode(mode: Mode): Promise<void> {
    const tab = this.active;
    if (!tab || tab.mode === mode) return;
    await this.showMode(tab, mode, { restoreScroll: true });
  }

  cycleMode(): void {
    const order: Mode[] = ["view", "wysiwyg", "source"];
    const tab = this.active;
    if (!tab) return;
    void this.setMode(order[(order.indexOf(tab.mode) + 1) % order.length] ?? "view");
  }

  async save(tab: Tab | null = this.active, forceDialog = false): Promise<boolean> {
    if (!tab) return false;
    const text = this.currentText(tab);
    let path = tab.path;
    if (!path || forceDialog) {
      path = await this.host.pickSavePath(tab.name);
      if (!path) return false;
    }
    try {
      const raw = denormalise(text, tab.baseline);
      const saved = await this.host.save(path, raw);
      const moved = saved.path !== tab.path;
      tab.path = saved.path;
      tab.name = saved.name;
      tab.dir = saved.dir;
      tab.button.title = saved.path;
      tab.baseline = normalise(raw);
      tab.text = tab.baseline.text;
      tab.conflict = false;
      this.hideBanner(tab);
      this.markClean(tab);
      if (moved) {
        tab.unwatch?.();
        tab.unwatch = await this.host.watch(saved.path, () => void this.onDiskChange(tab));
      }
      this.refreshTitle(tab);
      return true;
    } catch (error) {
      this.host.onError(`${tab.name}\n${describe(error)}`);
      return false;
    }
  }

  reloadActive(): void {
    if (this.active) void this.reloadFromDisk(this.active);
  }

  /** Re-renders reading views after a settings change. */
  async rerenderAll(): Promise<void> {
    for (const tab of this.tabs) {
      if (tab.mode === "view") await this.renderView(tab, { restoreScroll: true });
    }
  }

  retheme(): void {
    const dark = this.host.theme() === "dark";
    for (const tab of this.tabs) {
      if (tab.mode === "view") void renderDiagrams(tab.article, this.host.theme());
      tab.source?.setDark(dark);
    }
  }

  // --- internals -----------------------------------------------------------

  private createTab(path: string | null, name: string, dir: string | null, raw: string): Tab {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", "false");
    button.title = path ?? name;

    const label = document.createElement("span");
    label.className = "tab__label";
    label.textContent = name;

    const close = document.createElement("span");
    close.className = "tab__close";
    close.setAttribute("aria-label", "Close tab");
    close.textContent = "×";
    button.append(label, close);

    const panel = document.createElement("section");
    panel.className = "panel";
    panel.hidden = true;

    const banner = document.createElement("div");
    banner.className = "banner";
    banner.hidden = true;

    const article = document.createElement("article");
    article.className = "document";
    panel.append(banner, article);

    const baseline = normalise(raw);
    return {
      path, name, dir, sandboxed: false, title: name, mode: "view", dirty: false, conflict: false,
      button, panel, article, banner, text: baseline.text, baseline,
      wysiwyg: null, source: null, unwatch: null, busy: null, autosaveTimer: null,
    };
  }

  private mount(tab: Tab): void {
    this.tabs.push(tab);
    this.strip.appendChild(tab.button);
    this.viewer.appendChild(tab.panel);
    this.activate(tab);
  }

  /** The buffer as it stands in whichever mode is active. */
  private currentText(tab: Tab): string {
    if (tab.mode === "source" && tab.source) return tab.source.getText();
    if (tab.mode === "wysiwyg" && tab.wysiwyg) {
      return tab.wysiwyg.isPristine() ? tab.text : tab.wysiwyg.getMarkdown();
    }
    return tab.text;
  }

  private async showMode(tab: Tab, mode: Mode, options: { restoreScroll: boolean }): Promise<void> {
    if (tab.busy) await tab.busy;
    tab.busy = (async () => {
      // Capture the buffer and an anchor for the cursor before tearing down.
      const text = this.currentText(tab);
      const anchor =
        tab.mode === "wysiwyg" ? tab.wysiwyg?.cursorBlockText() ?? "" :
        tab.mode === "source" ? tab.source?.cursorLineText() ?? "" : "";
      tab.text = text;
      await this.teardownEditors(tab);
      tab.mode = mode;
      tab.article.innerHTML = "";
      tab.article.className = "document";

      if (mode === "view") {
        await this.renderView(tab, options);
      } else if (mode === "wysiwyg") {
        tab.article.className = "editor-host";
        const { createWysiwyg } = await loadWysiwyg();
        tab.wysiwyg = await createWysiwyg(tab.article, tab.text, {
          dir: tab.dir,
          assetUrl: this.host.assetUrl,
          onChange: () => this.onEdit(tab),
        });
        if (anchor) tab.wysiwyg.selectBlockContaining(anchor);
      } else {
        tab.article.className = "source-host";
        const { createSource } = await loadSource();
        tab.source = createSource(tab.article, tab.text, {
          dark: this.host.theme() === "dark",
          onChange: () => this.onEdit(tab),
        });
        if (anchor) tab.source.setCursorToLineContaining(anchor);
      }
      this.updateDirty(tab);
      this.host.onActiveChange(this.active);
      this.focusEditor(tab);
    })();
    try {
      await tab.busy;
    } finally {
      tab.busy = null;
    }
  }

  private async renderView(tab: Tab, options: { restoreScroll: boolean }): Promise<void> {
    const scroller = this.viewer;
    const previousTop = scroller.scrollTop;
    const maxScroll = Math.max(scroller.scrollHeight - scroller.clientHeight, 0);
    const atBottom = maxScroll > 0 && previousTop / maxScroll >= 0.98;

    const ctx: RenderContext = {
      dir: tab.dir ?? "",
      allowRemoteImages: this.host.allowRemoteImages(),
      assetUrl: this.host.assetUrl,
      theme: this.host.theme,
      onLocalImageError: tab.sandboxed ? () => this.host.onFolderUnreadable?.(tab) : undefined,
    };
    const result = await renderDocument(tab.article, tab.text, ctx);
    tab.title = result.title ?? tab.name;
    this.refreshTitle(tab);

    if (this.active === tab && options.restoreScroll) {
      const restore = () => {
        const max = Math.max(scroller.scrollHeight - scroller.clientHeight, 0);
        scroller.scrollTop = atBottom ? max : Math.min(previousTop, max);
      };
      restore();
      requestAnimationFrame(() => requestAnimationFrame(restore));
    }
  }

  private async teardownEditors(tab: Tab): Promise<void> {
    if (tab.wysiwyg) {
      await tab.wysiwyg.destroy();
      tab.wysiwyg = null;
    }
    if (tab.source) {
      tab.source.destroy();
      tab.source = null;
    }
  }

  private focusEditor(tab: Tab): void {
    if (tab.mode === "wysiwyg") tab.wysiwyg?.focus();
    else if (tab.mode === "source") tab.source?.focus();
  }

  private onEdit(tab: Tab): void {
    this.updateDirty(tab);
    this.host.onEdit?.(tab);
    if (tab.dirty && tab.path && this.host.autosave() && !tab.conflict) {
      if (tab.autosaveTimer) window.clearTimeout(tab.autosaveTimer);
      tab.autosaveTimer = window.setTimeout(() => {
        tab.autosaveTimer = null;
        void this.save(tab);
      }, 1000);
    }
  }

  private updateDirty(tab: Tab): void {
    let dirty: boolean;
    if (tab.mode === "wysiwyg" && tab.wysiwyg) dirty = !tab.wysiwyg.isPristine() && tab.wysiwyg.getMarkdown() !== tab.baseline.text;
    else if (tab.mode === "source" && tab.source) dirty = tab.source.getText() !== tab.baseline.text;
    else dirty = tab.text !== tab.baseline.text;
    if (tab.path === null && tab.mode !== "view") dirty = dirty || this.currentText(tab).length > 0;
    if (dirty !== tab.dirty) {
      tab.dirty = dirty;
      tab.button.classList.toggle("tab--dirty", dirty);
      this.host.onTabStateChange(tab);
    }
  }

  private markClean(tab: Tab): void {
    if (tab.wysiwyg) tab.wysiwyg.setMarkdown(tab.text);
    tab.dirty = false;
    tab.button.classList.remove("tab--dirty");
    this.host.onTabStateChange(tab);
  }

  private refreshTitle(tab: Tab): void {
    const label = tab.button.querySelector(".tab__label");
    if (label) label.textContent = tab.mode === "view" ? tab.title : tab.name;
    if (this.active === tab) this.host.onActiveChange(tab);
  }

  private async onDiskChange(tab: Tab): Promise<void> {
    if (!tab.path) return;
    let doc: LoadedDocument;
    try {
      doc = await this.host.load(tab.path);
    } catch {
      return; // Deleted or unreadable; keep what we have.
    }
    const incoming = normalise(doc.text);
    if (incoming.text === tab.baseline.text) return; // Our own save, or a no-op write.

    if (!tab.dirty) {
      await this.applyDiskText(tab, doc.text);
      return;
    }
    tab.conflict = true;
    this.showBanner(tab, "This file changed on disk while you have unsaved edits.", [
      ["Reload from disk", () => void this.applyDiskText(tab, doc.text).then(() => { tab.conflict = false; this.hideBanner(tab); })],
      ["Keep my changes", () => { tab.baseline = incoming; tab.conflict = false; this.hideBanner(tab); this.updateDirty(tab); }],
    ]);
  }

  private async reloadFromDisk(tab: Tab): Promise<void> {
    if (!tab.path) return;
    if (tab.dirty && !(await this.host.confirmDiscard(`Discard unsaved changes to “${tab.name}” and reload?`))) return;
    try {
      const doc = await this.host.load(tab.path);
      tab.conflict = false;
      this.hideBanner(tab);
      await this.applyDiskText(tab, doc.text);
    } catch (error) {
      this.host.onError(`${tab.name}\n${describe(error)}`);
    }
  }

  private async applyDiskText(tab: Tab, raw: string): Promise<void> {
    tab.baseline = normalise(raw);
    tab.text = tab.baseline.text;
    if (tab.mode === "view") await this.renderView(tab, { restoreScroll: true });
    else if (tab.mode === "wysiwyg") tab.wysiwyg?.setMarkdown(tab.text);
    else tab.source?.setText(tab.text);
    this.updateDirty(tab);
  }

  private showBanner(tab: Tab, message: string, actions: Array<[string, () => void]>): void {
    tab.banner.replaceChildren();
    const text = document.createElement("span");
    text.textContent = message;
    tab.banner.appendChild(text);
    for (const [label, handler] of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "banner__action";
      button.textContent = label;
      button.addEventListener("click", handler);
      tab.banner.appendChild(button);
    }
    tab.banner.hidden = false;
  }

  private hideBanner(tab: Tab): void {
    tab.banner.hidden = true;
    tab.banner.replaceChildren();
  }
}

function lastIndexWhere<T>(items: T[], test: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (test(items[i]!)) return i;
  }
  return -1;
}

function describe(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "Unknown error.";
}
