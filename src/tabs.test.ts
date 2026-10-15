// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

// Integration test of the tab state machine against a fake shell.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { Tabs, type LoadedDocument, type Tab, type TabHost } from "./tabs";

interface FakeFs {
  files: Map<string, string>;
  watchers: Map<string, () => void>;
}

function makeHost(fs: FakeFs, overrides: Partial<TabHost> = {}): TabHost & { saves: Array<[string, string]> } {
  const saves: Array<[string, string]> = [];
  return {
    saves,
    load: async (path: string): Promise<LoadedDocument> => {
      const text = fs.files.get(path);
      if (text === undefined) throw new Error("missing");
      return { path, name: path.split("/").pop() ?? path, dir: path.slice(0, path.lastIndexOf("/")), text };
    },
    save: async (path, text) => {
      saves.push([path, text]);
      fs.files.set(path, text);
      return { path, name: path.split("/").pop() ?? path, dir: path.slice(0, path.lastIndexOf("/")) };
    },
    pickSavePath: async () => "/docs/new.md",
    confirmDiscard: async () => true,
    confirmClose: async () => "discard",
    watch: async (path, onChange) => {
      fs.watchers.set(path, onChange);
      return () => fs.watchers.delete(path);
    },
    assetUrl: (p) => `asset://${p}`,
    theme: () => "light",
    allowRemoteImages: () => true,
    autosave: () => false,
    onActiveChange: () => {},
    onTabStateChange: () => {},
    onError: (m) => {
      throw new Error(m);
    },
    ...overrides,
  };
}

function mount(): { strip: HTMLElement; viewer: HTMLElement } {
  document.body.innerHTML = '<header id="tabs"></header><main id="viewer"></main>';
  return { strip: document.getElementById("tabs")!, viewer: document.getElementById("viewer")! };
}

describe("Tabs", () => {
  let fs: FakeFs;

  beforeEach(() => {
    fs = { files: new Map([["/docs/a.md", "# A\r\n\r\nhello *world*\r\n"]]), watchers: new Map() };
    // jsdom lacks layout APIs CodeMirror probes.
    Object.defineProperty(HTMLElement.prototype, "getClientRects", { value: () => [] as unknown as DOMRectList, configurable: true });
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => new DOMRect();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("opens in reading view, is clean, and never writes an unedited file", async () => {
    const { strip, viewer } = mount();
    const host = makeHost(fs);
    const tabs = new Tabs(strip, viewer, host);
    await tabs.open(["/docs/a.md"]);
    const tab = tabs.current as Tab;
    expect(tab.mode).toBe("view");
    expect(tab.dirty).toBe(false);
    expect(tab.title).toBe("A");
    expect(viewer.querySelector("h1")?.textContent).toBe("A");
    await tabs.save();
    // Saving a clean tab writes the identical bytes (CRLF preserved).
    expect(host.saves).toEqual([["/docs/a.md", "# A\r\n\r\nhello *world*\r\n"]]);
  });

  it("source edits become dirty and save with the file's line endings", async () => {
    const { strip, viewer } = mount();
    const host = makeHost(fs);
    const tabs = new Tabs(strip, viewer, host);
    await tabs.open(["/docs/a.md"]);
    await tabs.setMode("source");
    const tab = tabs.current as Tab;
    expect(tab.source).not.toBeNull();
    tab.source!.setText("# A\n\nedited\n");
    expect(tab.dirty).toBe(true);
    expect(tab.button.classList.contains("tab--dirty")).toBe(true);
    expect(await tabs.save()).toBe(true);
    expect(host.saves.at(-1)).toEqual(["/docs/a.md", "# A\r\n\r\nedited\r\n"]);
    expect(tab.dirty).toBe(false);
  });

  it("previews unsaved edits in reading view without touching disk", async () => {
    const { strip, viewer } = mount();
    const host = makeHost(fs);
    const tabs = new Tabs(strip, viewer, host);
    await tabs.open(["/docs/a.md"]);
    await tabs.setMode("source");
    (tabs.current as Tab).source!.setText("# Changed\n");
    await tabs.setMode("view");
    expect(viewer.querySelector("h1")?.textContent).toBe("Changed");
    expect((tabs.current as Tab).dirty).toBe(true);
    expect(host.saves).toEqual([]);
  });

  it("reloads silently on disk change when clean, flags a conflict when dirty", async () => {
    const { strip, viewer } = mount();
    const host = makeHost(fs);
    const tabs = new Tabs(strip, viewer, host);
    await tabs.open(["/docs/a.md"]);
    fs.files.set("/docs/a.md", "# From disk\n");
    fs.watchers.get("/docs/a.md")!();
    await flush();
    expect(viewer.querySelector("h1")?.textContent).toBe("From disk");
    expect((tabs.current as Tab).dirty).toBe(false);

    await tabs.setMode("source");
    const tab = tabs.current as Tab;
    tab.source!.setText("# Mine\n");
    fs.files.set("/docs/a.md", "# Theirs\n");
    fs.watchers.get("/docs/a.md")!();
    await flush();
    expect(tab.conflict).toBe(true);
    expect(tab.banner.hidden).toBe(false);
    expect(tab.source!.getText()).toBe("# Mine\n");
  });

  it("asks before closing a dirty tab and keeps it on cancel", async () => {
    const { strip, viewer } = mount();
    const host = makeHost(fs, { confirmClose: async () => "cancel" });
    const tabs = new Tabs(strip, viewer, host);
    await tabs.open(["/docs/a.md"]);
    await tabs.setMode("source");
    (tabs.current as Tab).source!.setText("x");
    expect(await tabs.close(tabs.current as Tab)).toBe(false);
    expect(tabs.all.length).toBe(1);
    expect(await tabs.confirmCloseAll()).toBe(false);
    expect(host.saves).toEqual([]);
  });

  it("saves and closes when the user chooses Save", async () => {
    const { strip, viewer } = mount();
    const host = makeHost(fs, { confirmClose: async () => "save" });
    const tabs = new Tabs(strip, viewer, host);
    await tabs.open(["/docs/a.md"]);
    await tabs.setMode("source");
    (tabs.current as Tab).source!.setText("# Saved on close\n");
    expect(await tabs.close(tabs.current as Tab)).toBe(true);
    expect(tabs.all.length).toBe(0);
    expect(host.saves.length).toBe(1);
    expect(host.saves[0]?.[0]).toBe("/docs/a.md");
    expect(host.saves[0]?.[1]).toContain("Saved on close");
  });

  it("keeps the tab when Save is chosen but the Save As dialog is cancelled", async () => {
    const { strip, viewer } = mount();
    const host = makeHost(fs, { confirmClose: async () => "save", pickSavePath: async () => null });
    const tabs = new Tabs(strip, viewer, host);
    await tabs.newDocument();
    await tabs.setMode("source");
    (tabs.current as Tab).source!.setText("draft");
    expect(await tabs.confirmCloseAll()).toBe(false);
    expect(tabs.all.length).toBe(1);
    expect(host.saves).toEqual([]);
  });

  it("new documents ask for a path on first save and then watch it", async () => {
    const { strip, viewer } = mount();
    const host = makeHost(fs);
    const tabs = new Tabs(strip, viewer, host);
    await tabs.newDocument();
    const tab = tabs.current as Tab;
    expect(tab.path).toBeNull();
    expect(tab.mode).toBe("wysiwyg");
    await tabs.setMode("source");
    tab.source!.setText("# New\n");
    expect(await tabs.save()).toBe(true);
    expect(tab.path).toBe("/docs/new.md");
    expect(host.saves).toEqual([["/docs/new.md", "# New\n"]]);
    expect(fs.watchers.has("/docs/new.md")).toBe(true);
  });

  it("WYSIWYG: saving keeps the editor document instead of reloading it", async () => {
    const { strip, viewer } = mount();
    const host = makeHost(fs);
    const tabs = new Tabs(strip, viewer, host);
    await tabs.open(["/docs/a.md"]);
    await tabs.setMode("wysiwyg");
    const tab = tabs.current as Tab;
    const reload = vi.spyOn(tab.wysiwyg!, "setMarkdown");
    const rebase = vi.spyOn(tab.wysiwyg!, "markSaved");
    expect(await tabs.save()).toBe(true);
    // Replacing the document would throw the cursor to the end on every autosave.
    expect(reload).not.toHaveBeenCalled();
    expect(rebase).toHaveBeenCalledTimes(1);
    expect(tab.wysiwyg!.isPristine()).toBe(true);
    expect(tab.dirty).toBe(false);
  });

  it("WYSIWYG: untouched document stays pristine; edits serialise to markdown", async () => {
    const { strip, viewer } = mount();
    const host = makeHost(fs);
    const tabs = new Tabs(strip, viewer, host);
    await tabs.open(["/docs/a.md"]);
    await tabs.setMode("wysiwyg");
    const tab = tabs.current as Tab;
    expect(tab.wysiwyg).not.toBeNull();
    expect(tab.wysiwyg!.isPristine()).toBe(true);
    expect(tab.dirty).toBe(false);
    expect(viewer.querySelector(".ProseMirror h1")?.textContent).toBe("A");
    await tabs.setMode("source");
    // Round trip through the editor without edits keeps the original text.
    expect(tab.source!.getText()).toBe("# A\n\nhello *world*\n");
  });
});

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
}
