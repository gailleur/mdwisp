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
  /** Save / Discard / Cancel before a dirty document closes. */
  confirmClose: (name: string) => Promise<"save" | "discard" | "cancel">;
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
  /** The tabs were put in a different order (drag, or `move`). */
  onReorder?: () => void;
  /** A tab was added, removed or moved. */
  onListChange?: () => void;
  onError: (message: string) => void;
}

export interface OpenOptions {
  /**
   * Open as the preview tab: a passing look at a document, shown in italics,
   * which the next preview replaces. See `Tabs.pin` for what keeps it.
   */
  preview?: boolean;
  /** Skip documents that cannot be opened instead of reporting them. */
  quiet?: boolean;
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
  /** A preview tab: replaced by the next preview unless it is kept. */
  preview: boolean;
  /** The user chose to load this document's remote images (not persisted). */
  allowRemote: boolean;
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
  /** Opens run one after the other, so one never overtakes or replaces a tab still loading. */
  private opening: Promise<void> = Promise.resolve();

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
    strip.addEventListener("dblclick", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest(".tab__close")) return;
      const button = target.closest<HTMLButtonElement>("button.tab");
      const tab = this.tabs.find((t) => t.button === button);
      if (tab) this.pin(tab);
    });
    // Press selects at once; a sideways pull from there reorders.
    strip.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest(".tab__close")) return;
      const button = target.closest<HTMLButtonElement>("button.tab");
      const tab = this.tabs.find((t) => t.button === button);
      if (!tab) return;
      this.activate(tab);
      if (this.tabs.length > 1) this.startDrag(event, tab);
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

  /**
   * Opens documents as tabs, the last one in front. A document already
   * open is brought forward rather than opened twice.
   */
  open(paths: string[], options: OpenOptions = {}): Promise<void> {
    const run = () => this.openNow(paths, options);
    this.opening = this.opening.then(run, run);
    return this.opening;
  }

  private async openNow(paths: string[], options: OpenOptions): Promise<void> {
    const bringForward = (tab: Tab) => {
      // Asking for a document outright keeps it, even if it was a preview.
      if (!options.preview) this.pin(tab);
      this.activate(tab);
    };
    for (const path of paths) {
      const existing = this.tabs.find((t) => t.path === path);
      if (existing) {
        bringForward(existing);
        continue;
      }
      try {
        const doc = await this.host.load(path);
        const canonical = this.tabs.find((t) => t.path === doc.path);
        if (canonical) {
          bringForward(canonical);
          continue;
        }
        const tab = this.createTab(doc.path, doc.name, doc.dir, doc.text);
        tab.sandboxed = doc.sandboxed === true;
        // A preview takes the place of the previous one, in the same spot.
        const replaced = options.preview ? this.tabs.find((t) => t.preview && !t.dirty) : undefined;
        if (options.preview) this.setPreview(tab, true);
        this.mount(tab, replaced ? this.tabs.indexOf(replaced) : undefined);
        if (replaced) await this.close(replaced);
        await this.showMode(tab, "view", { restoreScroll: false });
        tab.unwatch = await this.host.watch(doc.path, () => void this.onDiskChange(tab));
      } catch (error) {
        if (!options.quiet) this.host.onError(`${path}\n${describe(error)}`);
      }
    }
  }

  /**
   * Keeps a preview tab: it becomes an ordinary tab. Called on a
   * double-click on the tab or the file, on the first edit, when the tab
   * is dragged to another place, and when the document is asked for
   * outright (the Open dialog, go to file, a search result).
   */
  pin(tab: Tab): void {
    if (!tab.preview) return;
    this.setPreview(tab, false);
    this.host.onTabStateChange(tab);
  }

  /** Keeps every preview tab (previews were switched off). */
  pinAll(): void {
    for (const tab of this.tabs) this.pin(tab);
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
    if (!(await this.settleBeforeClose(tab))) return false;
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
    this.host.onListChange?.();
    return true;
  }

  closeActive(): void {
    if (this.active) void this.close(this.active);
  }

  /** Puts `tab` at `index` (clamped) in the strip, shifting the others. */
  move(tab: Tab, index: number): void {
    const from = this.tabs.indexOf(tab);
    if (from < 0) return;
    const to = Math.max(0, Math.min(index, this.tabs.length - 1));
    if (from === to) return;
    this.tabs.splice(from, 1);
    this.tabs.splice(to, 0, tab);
    const next = this.tabs[to + 1];
    this.strip.insertBefore(tab.button, next ? next.button : null);
    this.pin(tab);
    this.host.onReorder?.();
    this.host.onListChange?.();
  }

  /** Returns true when every tab agreed to close (used before quitting). */
  async confirmCloseAll(): Promise<boolean> {
    for (const tab of [...this.tabs]) {
      if (!tab.dirty) continue;
      this.activate(tab);
      if (!(await this.settleBeforeClose(tab))) return false;
    }
    return true;
  }

  /**
   * For a dirty tab, asks Save / Discard / Cancel. Resolves true when the
   * tab may close: saved, or discarded. A save that does not complete (the
   * Save As dialog was cancelled, or writing failed) keeps the tab open.
   */
  private async settleBeforeClose(tab: Tab): Promise<boolean> {
    if (!tab.dirty) return true;
    const choice = await this.host.confirmClose(tab.name);
    if (choice === "cancel") return false;
    if (choice === "save") return this.save(tab);
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

  /** Re-renders reading views and re-applies settings to editors. */
  async rerenderAll(): Promise<void> {
    for (const tab of this.tabs) await this.refreshRemote(tab);
  }

  retheme(): void {
    const dark = this.host.theme() === "dark";
    for (const tab of this.tabs) {
      if (tab.mode === "view") void renderDiagrams(tab.article, this.host.theme());
      tab.source?.setDark(dark);
    }
  }

  // --- internals -----------------------------------------------------------

  /**
   * Drag to reorder. The pressed tab follows the pointer sideways while the
   * others slide aside to show where it will land; the strip itself is only
   * reordered on release. (Moving the button in the DOM mid-drag would make
   * the webview drop its pointer capture.) Nothing happens until the
   * pointer has moved a few pixels, so a plain click stays a click.
   */
  private startDrag(event: PointerEvent, tab: Tab): void {
    const button = tab.button;
    const strip = this.strip;
    const stripLeft = strip.getBoundingClientRect().left - strip.scrollLeft;
    // Where every tab sits in the strip's scrolled content, fixed for the
    // whole drag since the DOM does not change until the drop.
    const slots = this.tabs.map((t) => {
      const rect = t.button.getBoundingClientRect();
      return { left: rect.left - stripLeft, width: rect.width };
    });
    const from = this.tabs.indexOf(tab);
    const own = slots[from];
    if (!own) return;
    const grab = event.clientX - stripLeft - own.left;
    const startX = event.clientX;
    let target = from;
    let dragging = false;

    const move = (e: PointerEvent) => {
      if (!dragging) {
        if (Math.abs(e.clientX - startX) < 4) return;
        dragging = true;
        button.classList.add("tab--dragging");
        strip.classList.add("tabs--dragging");
        document.body.classList.add("is-dragging-tab");
      }
      // The order follows the unclamped position, so a pull past either end
      // still lands the tab there; only the drawing is kept inside the strip.
      const wanted = e.clientX - stripLeft - grab;
      const middle = wanted + own.width / 2;
      target = 0;
      slots.forEach((slot, i) => {
        if (i !== from && middle > slot.left + slot.width / 2) target += 1;
      });
      const left = Math.max(0, Math.min(wanted, strip.scrollWidth - own.width));
      button.style.transform = `translateX(${Math.round(left - own.left)}px)`;
      this.tabs.forEach((other, i) => {
        if (other === tab) return;
        const shift =
          from < target && i > from && i <= target ? -own.width :
          target < from && i >= target && i < from ? own.width : 0;
        other.button.style.transform = shift ? `translateX(${Math.round(shift)}px)` : "";
      });
    };
    const finish = (e: PointerEvent) => {
      button.removeEventListener("pointermove", move);
      button.removeEventListener("pointerup", finish);
      button.removeEventListener("pointercancel", finish);
      button.removeEventListener("lostpointercapture", finish);
      if (button.hasPointerCapture(e.pointerId)) button.releasePointerCapture(e.pointerId);
      for (const t of this.tabs) t.button.style.transform = "";
      button.classList.remove("tab--dragging");
      strip.classList.remove("tabs--dragging");
      document.body.classList.remove("is-dragging-tab");
      if (dragging) this.move(tab, target);
    };
    button.setPointerCapture(event.pointerId);
    button.addEventListener("pointermove", move);
    button.addEventListener("pointerup", finish);
    button.addEventListener("pointercancel", finish);
    button.addEventListener("lostpointercapture", finish);
  }

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
      path, name, dir, sandboxed: false, title: name, mode: "view", dirty: false, conflict: false, preview: false,
      allowRemote: false, button, panel, article, banner, text: baseline.text, baseline,
      wysiwyg: null, source: null, unwatch: null, busy: null, autosaveTimer: null,
    };
  }

  /** Adds a tab to the strip, at `index` if given, else at the end, and shows it. */
  private mount(tab: Tab, index?: number): void {
    const before = index === undefined ? undefined : this.tabs[index];
    if (before) this.tabs.splice(index!, 0, tab);
    else this.tabs.push(tab);
    this.strip.insertBefore(tab.button, before ? before.button : null);
    this.viewer.appendChild(tab.panel);
    this.activate(tab);
    this.host.onListChange?.();
  }

  private setPreview(tab: Tab, on: boolean): void {
    tab.preview = on;
    tab.button.classList.toggle("tab--preview", on);
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
          allowRemoteImages: () => this.remoteAllowed(tab),
          onChange: () => this.onEdit(tab),
        });
        if (anchor) tab.wysiwyg.selectBlockContaining(anchor);
        this.reflectRemote(tab, tab.wysiwyg.blockedRemoteImages());
      } else {
        tab.article.className = "source-host";
        if (!tab.conflict) this.hideBanner(tab);
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
      allowRemoteImages: this.remoteAllowed(tab),
      assetUrl: this.host.assetUrl,
      theme: this.host.theme,
      onLocalImageError: tab.sandboxed ? () => this.host.onFolderUnreadable?.(tab) : undefined,
    };
    const result = await renderDocument(tab.article, tab.text, ctx);
    tab.title = result.title ?? tab.name;
    this.refreshTitle(tab);
    this.reflectRemote(tab, result.remoteBlocked);

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
    // Editors also report changes they make themselves while loading;
    // only a change that leaves the document edited keeps a preview.
    if (tab.dirty) this.pin(tab);
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
    if (tab.wysiwyg) {
      // The editor's own content was just saved: keep the document (and
      // with it the cursor, selection and undo history) and only move the
      // pristine mark. Reloading it would throw the cursor to the end on
      // every autosave. A save made from another mode does need to reach
      // the hidden editor instance.
      if (tab.mode === "wysiwyg") tab.wysiwyg.markSaved();
      else tab.wysiwyg.setMarkdown(tab.text);
    }
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

  /** Remote images load when allowed everywhere (View menu) or for this document (banner). */
  private remoteAllowed(tab: Tab): boolean {
    return this.host.allowRemoteImages() || tab.allowRemote;
  }

  /** Applies the current remote-image setting to a tab in whatever mode it is in. */
  private async refreshRemote(tab: Tab): Promise<void> {
    if (tab.mode === "view") await this.renderView(tab, { restoreScroll: true });
    else if (tab.mode === "wysiwyg" && tab.wysiwyg) {
      tab.wysiwyg.refreshImages();
      this.reflectRemote(tab, tab.wysiwyg.blockedRemoteImages());
    }
  }

  /**
   * Shows, or clears, the banner that offers to load a document's remote
   * images. A disk-conflict banner takes precedence.
   */
  private reflectRemote(tab: Tab, blocked: number): void {
    if (tab.conflict) return;
    if (blocked > 0 && !this.remoteAllowed(tab)) {
      const what = blocked === 1 ? "1 remote image" : `${blocked} remote images`;
      this.showBanner(tab, `This document references ${what}. Loading them tells their hosts you opened it.`, [
        ["Load remote images", () => { tab.allowRemote = true; void this.refreshRemote(tab); }],
      ]);
    } else {
      this.hideBanner(tab);
    }
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
