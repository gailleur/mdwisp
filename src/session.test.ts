// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

// The relaunch snapshot: capture from one Tabs instance, restore into a
// fresh one, as happens across an in-app update.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { captureSession, parseSession, restoreSession, saveSession, SESSION_KEY, takeSession } from "./session";
import { Tabs, type LoadedDocument, type Tab, type TabHost } from "./tabs";

const FILES = new Map<string, string>([
  ["/docs/a.md", "# A\n\none\n\ntwo\n\nthree\n"],
  ["/docs/b.md", "# B\n\nline two\nline three\nline four\n"],
  ["/docs/c.md", "# C\n"],
]);

function makeHost(): TabHost {
  return {
    load: async (path: string): Promise<LoadedDocument> => {
      const text = FILES.get(path);
      if (text === undefined) throw new Error("missing");
      return { path, name: path.split("/").pop() ?? path, dir: "/docs", text };
    },
    save: async (path) => ({ path, name: path, dir: "/docs" }),
    pickSavePath: async () => null,
    confirmDiscard: async () => true,
    confirmClose: async () => "discard",
    watch: async () => () => {},
    assetUrl: (p) => p,
    theme: () => "light",
    allowRemoteImages: () => true,
    autosave: () => false,
    onActiveChange: () => {},
    onTabStateChange: () => {},
    onError: () => {},
  };
}

function mount(): { strip: HTMLElement; viewer: HTMLElement } {
  document.body.innerHTML = '<header id="tabs"></header><main id="viewer"></main>';
  return { strip: document.getElementById("tabs")!, viewer: document.getElementById("viewer")! };
}

describe("session", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(HTMLElement.prototype, "getClientRects", { value: () => [] as unknown as DOMRectList, configurable: true });
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => new DOMRect();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("captures order, active tab, modes, positions and zoom, then restores them", async () => {
    const { strip, viewer } = mount();
    const tabs = new Tabs(strip, viewer, makeHost());
    await tabs.open(["/docs/a.md", "/docs/b.md", "/docs/c.md"]);
    await tabs.newDocument(); // untitled: not part of the snapshot
    tabs.activate(tabs.all[1] as Tab);
    await tabs.setMode("source");
    (tabs.current as Tab).source!.goToLine(3);
    tabs.activate(tabs.all[0] as Tab);
    await tabs.setMode("wysiwyg");
    tabs.activate(tabs.all[1] as Tab);

    const session = captureSession({ tabs, viewer, zoom: () => 1.25 });
    expect(session).toEqual({
      tabs: [
        { path: "/docs/a.md", mode: "wysiwyg", anchor: "A" },
        { path: "/docs/b.md", mode: "source", position: 3 },
        { path: "/docs/c.md", mode: "view" },
      ],
      active: 1,
      zoom: 1.25,
    });

    saveSession(session);
    expect(takeSession()).toEqual(session);
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();

    const fresh = mount();
    const again = new Tabs(fresh.strip, fresh.viewer, makeHost());
    const setZoom = vi.fn();
    await restoreSession(session, ["/docs/a.md", "/docs/b.md", "/docs/c.md"], { tabs: again, viewer: fresh.viewer }, setZoom);
    expect(setZoom).toHaveBeenCalledWith(1.25);
    expect(again.all.map((t) => [t.path, t.mode])).toEqual([
      ["/docs/a.md", "wysiwyg"],
      ["/docs/b.md", "source"],
      ["/docs/c.md", "view"],
    ]);
    expect(again.current?.path).toBe("/docs/b.md");
    expect(again.current?.source?.cursorLine()).toBe(3);
  });

  it("skips documents that are gone and still opens paths the command line adds", async () => {
    const { strip, viewer } = mount();
    const tabs = new Tabs(strip, viewer, makeHost());
    const session = {
      tabs: [
        { path: "/docs/missing.md", mode: "view" as const },
        { path: "/docs/c.md", mode: "view" as const },
      ],
      active: 1,
      zoom: 1,
    };
    await restoreSession(session, ["/docs/c.md", "/docs/a.md"], { tabs, viewer }, () => {});
    expect(tabs.all.map((t) => t.path)).toEqual(["/docs/c.md", "/docs/a.md"]);
    expect(tabs.current?.path).toBe("/docs/c.md");
  });

  it("rejects malformed snapshots and tolerates odd fields", () => {
    expect(parseSession("not json")).toBeNull();
    expect(parseSession('{"tabs":"x"}')).toBeNull();
    expect(parseSession('{"tabs":[{"path":"/p.md","mode":"bogus","position":-4},{"path":""}],"active":7,"zoom":-1}')).toEqual({
      tabs: [{ path: "/p.md", mode: "view" }],
      active: -1,
      zoom: 1,
    });
  });
});
