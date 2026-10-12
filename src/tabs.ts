// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Gailleur. All rights reserved.

import { renderDiagrams, renderDocument, type RenderContext } from "./render";
import type { EffectiveTheme } from "./theme";

export interface TabHost {
  /** Reads a document and grants access to its directory. */
  load: (path: string) => Promise<{ path: string; name: string; dir: string; text: string }>;
  /** Starts watching a file; returns a function that stops watching. */
  watch: (path: string, onChange: () => void) => Promise<() => void>;
  assetUrl: (path: string) => string;
  theme: () => EffectiveTheme;
  allowRemoteImages: () => boolean;
  onActiveChange: (tab: Tab | null) => void;
  onError: (message: string) => void;
}

export interface Tab {
  path: string;
  name: string;
  dir: string;
  title: string;
  button: HTMLButtonElement;
  article: HTMLElement;
  unwatch: (() => void) | null;
  reloading: Promise<void> | null;
}

export class Tabs {
  private readonly tabs: Tab[] = [];
  private active: Tab | null = null;

  constructor(
    private readonly strip: HTMLElement,
    private readonly viewer: HTMLElement,
    private readonly host: TabHost,
  ) {
    strip.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const button = target.closest<HTMLButtonElement>("button.tab");
      if (!button) return;
      const tab = this.tabs.find((t) => t.button === button);
      if (!tab) return;
      if (target.closest(".tab__close")) this.close(tab);
      else this.activate(tab);
    });
    strip.addEventListener("auxclick", (event) => {
      if (event.button !== 1) return;
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button.tab");
      const tab = this.tabs.find((t) => t.button === button);
      if (tab) this.close(tab);
    });
  }

  get current(): Tab | null {
    return this.active;
  }

  get count(): number {
    return this.tabs.length;
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
        // `load` canonicalises; check again with the real path.
        const canonical = this.tabs.find((t) => t.path === doc.path);
        if (canonical) {
          this.activate(canonical);
          continue;
        }
        const tab = this.createTab(doc);
        this.tabs.push(tab);
        this.strip.appendChild(tab.button);
        this.viewer.appendChild(tab.article);
        this.activate(tab);
        await this.render(tab, doc.text, { restoreScroll: false });
        tab.unwatch = await this.host.watch(doc.path, () => void this.reload(tab));
      } catch (error) {
        this.host.onError(`${path}\n${describe(error)}`);
      }
    }
  }

  activate(tab: Tab): void {
    if (this.active === tab) return;
    if (this.active) {
      this.active.button.classList.remove("tab--active");
      this.active.button.setAttribute("aria-selected", "false");
      this.active.article.hidden = true;
    }
    this.active = tab;
    tab.button.classList.add("tab--active");
    tab.button.setAttribute("aria-selected", "true");
    tab.article.hidden = false;
    tab.button.scrollIntoView({ block: "nearest", inline: "nearest" });
    this.host.onActiveChange(tab);
  }

  close(tab: Tab): void {
    const index = this.tabs.indexOf(tab);
    if (index < 0) return;
    tab.unwatch?.();
    tab.button.remove();
    tab.article.remove();
    this.tabs.splice(index, 1);
    if (this.active === tab) {
      this.active = null;
      const next = this.tabs[index] ?? this.tabs[index - 1] ?? null;
      if (next) this.activate(next);
      else this.host.onActiveChange(null);
    }
  }

  closeActive(): void {
    if (this.active) this.close(this.active);
  }

  /** Re-reads the file from disk and re-renders, keeping the scroll position. */
  async reload(tab: Tab): Promise<void> {
    if (tab.reloading) return tab.reloading;
    tab.reloading = (async () => {
      try {
        const doc = await this.host.load(tab.path);
        await this.render(tab, doc.text, { restoreScroll: true });
      } catch (error) {
        this.host.onError(`${tab.name}\n${describe(error)}`);
      } finally {
        tab.reloading = null;
      }
    })();
    return tab.reloading;
  }

  reloadActive(): void {
    if (this.active) void this.reload(this.active);
  }

  /** Re-renders every open document (e.g. after a settings change). */
  async rerenderAll(): Promise<void> {
    await Promise.all(this.tabs.map((tab) => this.reload(tab)));
  }

  /** Diagrams depend on the theme; re-render them in place. */
  retheme(): void {
    for (const tab of this.tabs) void renderDiagrams(tab.article, this.host.theme());
  }

  private createTab(doc: { path: string; name: string; dir: string }): Tab {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", "false");
    button.title = doc.path;

    const label = document.createElement("span");
    label.className = "tab__label";
    label.textContent = doc.name;

    const close = document.createElement("span");
    close.className = "tab__close";
    close.setAttribute("aria-label", "Close tab");
    close.textContent = "×";

    button.append(label, close);

    const article = document.createElement("article");
    article.className = "document";
    article.hidden = true;

    return { path: doc.path, name: doc.name, dir: doc.dir, title: doc.name, button, article, unwatch: null, reloading: null };
  }

  private async render(tab: Tab, text: string, options: { restoreScroll: boolean }): Promise<void> {
    const scroller = this.viewer;
    const wasActive = this.active === tab;
    const previousTop = scroller.scrollTop;
    const maxScroll = Math.max(scroller.scrollHeight - scroller.clientHeight, 0);
    const atBottom = maxScroll > 0 && previousTop / maxScroll >= 0.98;

    const ctx: RenderContext = {
      dir: tab.dir,
      allowRemoteImages: this.host.allowRemoteImages(),
      assetUrl: this.host.assetUrl,
      theme: this.host.theme,
    };
    const result = await renderDocument(tab.article, text, ctx);

    tab.title = result.title ?? tab.name;
    const label = tab.button.querySelector(".tab__label");
    if (label) label.textContent = tab.title;

    if (wasActive) {
      this.host.onActiveChange(tab);
      if (options.restoreScroll) {
        const restore = () => {
          const max = Math.max(scroller.scrollHeight - scroller.clientHeight, 0);
          scroller.scrollTop = atBottom ? max : Math.min(previousTop, max);
        };
        restore();
        requestAnimationFrame(() => requestAnimationFrame(restore));
      }
    }
  }
}

function describe(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "Unknown error.";
}
