// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

// Integration test of the tab state machine against a fake shell.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Encoding } from "./encoding";
import { Tabs, type LoadedDocument, type Tab, type TabHost } from "./tabs";

interface FakeFs {
  files: Map<string, string>;
  watchers: Map<string, () => void>;
  /** How a file reads; UTF-8 when absent. */
  encodings?: Map<string, Encoding>;
}

function makeHost(fs: FakeFs, overrides: Partial<TabHost> = {}): TabHost & { saves: Array<[string, string]>; savedIn: Encoding[] } {
  const saves: Array<[string, string]> = [];
  const savedIn: Encoding[] = [];
  return {
    saves,
    savedIn,
    load: async (path: string): Promise<LoadedDocument> => {
      const text = fs.files.get(path);
      if (text === undefined) throw new Error("missing");
      return { path, name: path.split("/").pop() ?? path, dir: path.slice(0, path.lastIndexOf("/")), text, encoding: fs.encodings?.get(path) };
    },
    save: async (path, text, encoding) => {
      saves.push([path, text]);
      savedIn.push(encoding);
      fs.encodings?.set(path, encoding);
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
    fs = { files: new Map([["/docs/a.md", "# A\r\n\r\nhello *world*\r\n"], ["/docs/b.md", "# B\n"], ["/docs/c.md", "# C\n"]]), watchers: new Map() };
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

describe("Tab order", () => {
  let fs: FakeFs;

  beforeEach(() => {
    fs = { files: new Map([["/docs/a.md", "# A\n"], ["/docs/b.md", "# B\n"], ["/docs/c.md", "# C\n"]]), watchers: new Map() };
    Element.prototype.scrollIntoView = vi.fn();
  });

  const names = (tabs: Tabs) => tabs.all.map((t) => t.name);
  const stripOrder = (strip: HTMLElement) => Array.from(strip.querySelectorAll(".tab__label")).map((el) => el.textContent);

  it("move() reorders the model and the strip together and reports it", async () => {
    const { strip, viewer } = mount();
    const onReorder = vi.fn();
    const tabs = new Tabs(strip, viewer, makeHost(fs, { onReorder }));
    await tabs.open(["/docs/a.md", "/docs/b.md", "/docs/c.md"]);
    const [a, , c] = tabs.all as [Tab, Tab, Tab];
    tabs.move(c, 0);
    expect(names(tabs)).toEqual(["c.md", "a.md", "b.md"]);
    expect(stripOrder(strip)).toEqual(["C", "A", "B"]);
    tabs.move(a, 99);
    expect(names(tabs)).toEqual(["c.md", "b.md", "a.md"]);
    expect(stripOrder(strip)).toEqual(["C", "B", "A"]);
    tabs.move(a, 2); // already there
    expect(onReorder).toHaveBeenCalledTimes(2);
  });

  it("a sideways drag slides the neighbours aside and reorders on release; a press alone selects", async () => {
    const { strip, viewer } = mount();
    const tabs = new Tabs(strip, viewer, makeHost(fs));
    await tabs.open(["/docs/a.md", "/docs/b.md", "/docs/c.md"]);
    const [a, b, c] = tabs.all as [Tab, Tab, Tab];
    // jsdom has no layout: give every tab a 100px slot in strip order.
    Object.defineProperty(strip, "scrollWidth", { value: 300, configurable: true });
    strip.getBoundingClientRect = () => new DOMRect(0, 0, 300, 38);
    tabs.all.forEach((t, i) => {
      t.button.getBoundingClientRect = () => new DOMRect(i * 100, 0, 100, 38);
      t.button.setPointerCapture = vi.fn();
      t.button.releasePointerCapture = vi.fn();
      t.button.hasPointerCapture = vi.fn(() => true);
    });
    const pointer = (target: HTMLElement, type: string, clientX: number) =>
      target.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX, button: 0 }), { pointerId: 1 }));

    // Press on A selects it. Pull it to the right, past B's and C's middles.
    expect(tabs.current).toBe(c);
    pointer(a.button, "pointerdown", 50);
    expect(tabs.current).toBe(a);
    pointer(a.button, "pointermove", 52); // under the drag threshold
    expect(a.button.classList.contains("tab--dragging")).toBe(false);
    pointer(a.button, "pointermove", 160);
    expect(a.button.classList.contains("tab--dragging")).toBe(true);
    expect(a.button.style.transform).toBe("translateX(110px)");
    expect(b.button.style.transform).toBe("translateX(-100px)");
    expect(c.button.style.transform).toBe("");
    expect(names(tabs)).toEqual(["a.md", "b.md", "c.md"]); // not yet
    pointer(a.button, "pointermove", 260);
    expect(c.button.style.transform).toBe("translateX(-100px)");
    pointer(a.button, "pointerup", 260);
    expect(names(tabs)).toEqual(["b.md", "c.md", "a.md"]);
    expect(stripOrder(strip)).toEqual(["B", "C", "A"]);
    expect(a.button.classList.contains("tab--dragging")).toBe(false);
    expect(tabs.all.every((t) => t.button.style.transform === "")).toBe(true);
    expect(document.body.classList.contains("is-dragging-tab")).toBe(false);

    // A press without movement changes nothing.
    pointer(b.button, "pointerdown", 50);
    pointer(b.button, "pointerup", 50);
    expect(names(tabs)).toEqual(["b.md", "c.md", "a.md"]);
    expect(tabs.current).toBe(b);

    // The close control is not a drag handle.
    pointer(a.button.querySelector<HTMLElement>(".tab__close")!, "pointerdown", 10);
    expect(tabs.current).toBe(b);
  });
});

describe("Preview tabs", () => {
  let fs: FakeFs;

  beforeEach(() => {
    fs = { files: new Map([["/docs/a.md", "# A\n"], ["/docs/b.md", "# B\n"], ["/docs/c.md", "# C\n"], ["/docs/d.md", "# D\n"]]), watchers: new Map() };
    Object.defineProperty(HTMLElement.prototype, "getClientRects", { value: () => [] as unknown as DOMRectList, configurable: true });
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => new DOMRect();
    Element.prototype.scrollIntoView = vi.fn();
  });

  const names = (tabs: Tabs) => tabs.all.map((t) => t.name);
  const previews = (tabs: Tabs) => tabs.all.filter((t) => t.preview).map((t) => t.name);

  it("a preview is one italic tab that the next preview replaces, in the same place", async () => {
    const { strip, viewer } = mount();
    const tabs = new Tabs(strip, viewer, makeHost(fs));
    await tabs.open(["/docs/a.md"]);
    await tabs.open(["/docs/b.md"], { preview: true });
    await tabs.open(["/docs/c.md"]);
    expect(names(tabs)).toEqual(["a.md", "b.md", "c.md"]);
    expect(previews(tabs)).toEqual(["b.md"]);
    expect(tabs.all[1]!.button.classList.contains("tab--preview")).toBe(true);

    await tabs.open(["/docs/d.md"], { preview: true });
    expect(names(tabs)).toEqual(["a.md", "d.md", "c.md"]);
    expect(Array.from(strip.querySelectorAll(".tab__label")).map((el) => el.textContent)).toEqual(["A", "D", "C"]);
    expect(previews(tabs)).toEqual(["d.md"]);
    expect(tabs.current?.name).toBe("d.md");
    // The replaced document is fully closed: no panel, no watcher left behind.
    expect(viewer.querySelectorAll(".panel").length).toBe(3);
    expect([...fs.watchers.keys()].sort()).toEqual(["/docs/a.md", "/docs/c.md", "/docs/d.md"]);
  });

  it("previews opened in quick succession still leave exactly one", async () => {
    const { strip, viewer } = mount();
    const tabs = new Tabs(strip, viewer, makeHost(fs));
    const all = [tabs.open(["/docs/a.md"], { preview: true }), tabs.open(["/docs/b.md"], { preview: true }), tabs.open(["/docs/c.md"], { preview: true })];
    await Promise.all(all);
    expect(names(tabs)).toEqual(["c.md"]);
    expect([...fs.watchers.keys()]).toEqual(["/docs/c.md"]);
    expect(viewer.querySelector("h1")?.textContent).toBe("C");
  });

  it("is kept by a double-click on the tab, by asking for the document outright, and by dragging it", async () => {
    const { strip, viewer } = mount();
    const onTabStateChange = vi.fn();
    const tabs = new Tabs(strip, viewer, makeHost(fs, { onTabStateChange }));

    await tabs.open(["/docs/a.md"], { preview: true });
    onTabStateChange.mockClear();
    tabs.current!.button.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(previews(tabs)).toEqual([]);
    expect(tabs.current!.button.classList.contains("tab--preview")).toBe(false);
    expect(onTabStateChange).toHaveBeenCalledTimes(1);

    await tabs.open(["/docs/b.md"], { preview: true });
    await tabs.open(["/docs/b.md"], { preview: true }); // another look changes nothing
    expect(previews(tabs)).toEqual(["b.md"]);
    await tabs.open(["/docs/b.md"]);
    expect(previews(tabs)).toEqual([]);

    await tabs.open(["/docs/c.md"], { preview: true });
    tabs.move(tabs.current as Tab, 0);
    expect(names(tabs)).toEqual(["c.md", "a.md", "b.md"]);
    expect(previews(tabs)).toEqual([]);
  });

  it("is kept by an edit, but not by merely switching to an editor", async () => {
    const { strip, viewer } = mount();
    const tabs = new Tabs(strip, viewer, makeHost(fs));
    await tabs.open(["/docs/a.md"], { preview: true });
    await tabs.setMode("source");
    const tab = tabs.current as Tab;
    expect(tab.preview).toBe(true);
    tab.source!.setText("# A\n\nedited\n");
    expect(tab.dirty).toBe(true);
    expect(tab.preview).toBe(false);

    // An edited document is never the one a new preview replaces.
    await tabs.open(["/docs/b.md"], { preview: true });
    expect(names(tabs)).toEqual(["a.md", "b.md"]);
  });

  it("an editor change leaves YAML front matter exactly as it was on disk", async () => {
    fs.files.set("/docs/post.md", "---\r\ntitle: Hello\r\ndate: 2026-01-02\r\n---\r\n\r\nbody\r\n");
    const { strip, viewer } = mount();
    const host = makeHost(fs);
    const tabs = new Tabs(strip, viewer, host);
    await tabs.open(["/docs/post.md"]);
    expect(viewer.querySelector("details.frontmatter")).not.toBeNull();
    await tabs.setMode("wysiwyg");
    const tab = tabs.current as Tab;
    tab.wysiwyg!.format("h2");
    // The editor reports edits through a debounced listener.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(tab.dirty).toBe(true);
    await tabs.save();
    expect(host.saves).toEqual([["/docs/post.md", "---\r\ntitle: Hello\r\ndate: 2026-01-02\r\n---\r\n\r\n## body\r\n"]]);
    expect(tab.dirty).toBe(false);
  });

  it("a Windows-1252 file is saved back in Windows-1252, and shows the encoding on the tab", async () => {
    fs.files.set("/docs/old.md", "caf\u00e9\n");
    fs.encodings = new Map([["/docs/old.md", "windows-1252"]]);
    const { strip, viewer } = mount();
    const host = makeHost(fs);
    const tabs = new Tabs(strip, viewer, host);
    await tabs.open(["/docs/old.md"]);
    const tab = tabs.current as Tab;
    expect(tab.encoding).toBe("windows-1252");
    await tabs.setMode("source");
    tab.source!.setText("caf\u00e9 \u2014 ok\n");
    await tabs.save();
    expect(host.saves).toEqual([["/docs/old.md", "caf\u00e9 \u2014 ok\n"]]);
    expect(host.savedIn).toEqual(["windows-1252"]);
    expect(tab.dirty).toBe(false);
  });

  it("a character the encoding cannot hold stops the save; the banner converts to UTF-8 and saves", async () => {
    fs.files.set("/docs/old.md", "caf\u00e9\n");
    fs.encodings = new Map([["/docs/old.md", "windows-1252"]]);
    const { strip, viewer } = mount();
    const host = makeHost(fs);
    const tabs = new Tabs(strip, viewer, host);
    await tabs.open(["/docs/old.md"]);
    const tab = tabs.current as Tab;
    await tabs.setMode("source");
    tab.source!.setText("caf\u00e9 \u2713\n");
    expect(await tabs.save()).toBe(false);
    expect(host.saves).toEqual([]);
    expect(tab.banner.hidden).toBe(false);
    expect(tab.banner.textContent).toContain("“\u2713” cannot be written in Windows-1252");
    tab.banner.querySelector("button")!.click();
    await flush();
    expect(host.saves).toEqual([["/docs/old.md", "caf\u00e9 \u2713\n"]]);
    expect(host.savedIn).toEqual(["utf-8"]);
    expect(tab.encoding).toBe("utf-8");
    expect(tab.diskEncoding).toBe("utf-8");
    expect(tab.dirty).toBe(false);
    expect(tab.banner.hidden).toBe(true);
  });

  it("converting to UTF-8 makes the tab dirty until the next save writes it", async () => {
    fs.files.set("/docs/bom.md", "# B\n");
    fs.encodings = new Map([["/docs/bom.md", "utf-8-bom"]]);
    const { strip, viewer } = mount();
    const states: boolean[] = [];
    const host = makeHost(fs, { onTabStateChange: (t) => { states.push(t.dirty); } });
    const tabs = new Tabs(strip, viewer, host);
    await tabs.open(["/docs/bom.md"]);
    const tab = tabs.current as Tab;
    tabs.setEncoding(tab, "utf-8");
    expect(tab.dirty).toBe(true);
    expect(states).toContain(true);
    tabs.setEncoding(tab, "utf-8-bom");
    expect(tab.dirty).toBe(false);
    tabs.setEncoding(tab, "utf-8");
    await tabs.save();
    expect(host.savedIn).toEqual(["utf-8"]);
    expect(tab.dirty).toBe(false);
    // A reload takes the encoding the disk now has.
    fs.files.set("/docs/bom.md", "# B2\n");
    fs.watchers.get("/docs/bom.md")?.();
    await flush();
    expect(tab.encoding).toBe("utf-8");
  });

  it("restore reads every file at once, renders only the front tab, and renders the others when shown", async () => {
    const { strip, viewer } = mount();
    const started: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const host = makeHost(fs, {
      load: async (path) => {
        started.push(path);
        await gate;
        const text = fs.files.get(path);
        if (text === undefined) throw new Error("missing");
        return { path, name: path.split("/").pop() ?? path, dir: "/docs", text };
      },
    });
    const tabs = new Tabs(strip, viewer, host);
    const placed: string[] = [];
    const restoring = tabs.restore(
      [
        { path: "/docs/a.md", mode: "source", place: (t) => placed.push(t.path ?? "") },
        { path: "/docs/b.md", mode: "view", place: (t) => placed.push(t.path ?? "") },
        { path: "/docs/c.md", mode: "wysiwyg", place: (t) => placed.push(t.path ?? "") },
      ],
      1,
    );
    await flush();
    // All three reads were started before any of them finished.
    expect(started).toEqual(["/docs/a.md", "/docs/b.md", "/docs/c.md"]);
    release();
    const opened = await restoring;
    expect(opened.map((t) => t?.path)).toEqual(["/docs/a.md", "/docs/b.md", "/docs/c.md"]);
    expect(tabs.current?.path).toBe("/docs/b.md");
    expect(viewer.querySelector("h1")?.textContent).toBe("B");
    expect(placed).toEqual(["/docs/b.md"]);
    // The others carry their mode already but hold no editor and no rendering.
    const a = opened[0] as Tab;
    const c = opened[2] as Tab;
    expect([a.mode, c.mode]).toEqual(["source", "wysiwyg"]);
    expect(a.source).toBeNull();
    expect(c.wysiwyg).toBeNull();
    expect(a.article.childElementCount).toBe(0);
    // Watches were set up without anyone waiting for them.
    expect([...fs.watchers.keys()].sort()).toEqual(["/docs/a.md", "/docs/b.md", "/docs/c.md"]);
    // Showing a deferred tab renders it in its mode and places it.
    tabs.activate(a);
    await a.busy;
    await flush();
    expect(a.source).not.toBeNull();
    expect(a.source!.getText()).toBe("# A\n");
    expect(placed).toEqual(["/docs/b.md", "/docs/a.md"]);
    expect(a.deferred).toBeNull();
  });

  it("restore reports a missing document, keeps the slot, and reuses a tab already open", async () => {
    const { strip, viewer } = mount();
    const errors: string[] = [];
    const host = makeHost(fs, { onError: (m) => { errors.push(m); } });
    const tabs = new Tabs(strip, viewer, host);
    await tabs.open(["/docs/c.md"]);
    const opened = await tabs.restore([{ path: "/docs/a.md", mode: "view" }, { path: "/docs/gone.md", mode: "view" }, { path: "/docs/c.md", mode: "view" }], 2);
    expect(opened.map((t) => t?.path)).toEqual(["/docs/a.md", undefined, "/docs/c.md"]);
    expect(tabs.all.map((t) => t.path)).toEqual(["/docs/c.md", "/docs/a.md"]);
    expect(errors).toHaveLength(1);
    expect(tabs.current?.path).toBe("/docs/c.md");
  });

  it("an edit in the editor never serialises the document just to mark it dirty", async () => {
    const { strip, viewer } = mount();
    const tabs = new Tabs(strip, viewer, makeHost(fs));
    await tabs.open(["/docs/a.md"]);
    await tabs.setMode("wysiwyg");
    const tab = tabs.current as Tab;
    const serialise = vi.spyOn(tab.wysiwyg!, "getMarkdown");
    tab.wysiwyg!.format("h2");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(tab.dirty).toBe(true);
    expect(serialise).not.toHaveBeenCalled();
  });

  it("a watcher event that matches our own save is not read back", async () => {
    const { strip, viewer } = mount();
    let onDisk = { size: 10, modified: 1000 };
    const loads: string[] = [];
    const host = makeHost(fs, {
      load: async (path) => {
        loads.push(path);
        return { path, name: "a.md", dir: "/docs", text: fs.files.get(path) ?? "", ...onDisk };
      },
      save: async (path, text) => {
        fs.files.set(path, text);
        onDisk = { size: text.length, modified: 2000 };
        return { path, name: "a.md", dir: "/docs", ...onDisk };
      },
      stat: async () => onDisk,
    });
    const tabs = new Tabs(strip, viewer, host);
    await tabs.open(["/docs/a.md"]);
    const tab = tabs.current as Tab;
    await tabs.setMode("source");
    tab.source!.setText("# A2\n");
    await tabs.save();
    expect(loads).toEqual(["/docs/a.md"]);
    // The watcher fires for our write: the stat matches, nothing is read.
    fs.watchers.get("/docs/a.md")!();
    await flush();
    expect(loads).toEqual(["/docs/a.md"]);
    // A real change on disk is still read.
    fs.files.set("/docs/a.md", "# A3\n");
    onDisk = { size: 5, modified: 3000 };
    fs.watchers.get("/docs/a.md")!();
    await flush();
    expect(loads).toEqual(["/docs/a.md", "/docs/a.md"]);
    expect(tab.text).toBe("# A3\n");
  });

  it("pinAll keeps every preview, and the list reports its changes", async () => {
    const { strip, viewer } = mount();
    const onListChange = vi.fn();
    const tabs = new Tabs(strip, viewer, makeHost(fs, { onListChange }));
    await tabs.open(["/docs/a.md"], { preview: true });
    expect(onListChange).toHaveBeenCalledTimes(1);
    tabs.pinAll();
    expect(previews(tabs)).toEqual([]);
    await tabs.open(["/docs/b.md"], { preview: true });
    expect(names(tabs)).toEqual(["a.md", "b.md"]);
    await tabs.close(tabs.all[0] as Tab);
    expect(onListChange).toHaveBeenCalledTimes(3);
  });

  it("can stay quiet about a document that cannot be opened", async () => {
    const { strip, viewer } = mount();
    const onError = vi.fn();
    const tabs = new Tabs(strip, viewer, makeHost(fs, { onError }));
    await tabs.open(["/docs/missing.md", "/docs/a.md"], { quiet: true });
    expect(names(tabs)).toEqual(["a.md"]);
    expect(onError).not.toHaveBeenCalled();
    await tabs.open(["/docs/missing.md"]);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
}
