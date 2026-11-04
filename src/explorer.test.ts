// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

import { describe, expect, it, vi } from "vitest";

import { ancestorsWithin, Explorer, sortEntries, type ExplorerEntry, type ExplorerHost } from "./explorer";

const tree: Record<string, ExplorerEntry[]> = {
  "/w": [
    { name: "readme.md", path: "/w/readme.md", kind: "file", markdown: true },
    { name: "docs", path: "/w/docs", kind: "dir", markdown: false },
    { name: "logo.png", path: "/w/logo.png", kind: "file", markdown: false },
    { name: "Archive", path: "/w/Archive", kind: "dir", markdown: false },
  ],
  "/w/docs": [
    { name: "spec.md", path: "/w/docs/spec.md", kind: "file", markdown: true },
    { name: "deep", path: "/w/docs/deep", kind: "dir", markdown: false },
  ],
  "/w/docs/deep": [{ name: "note.md", path: "/w/docs/deep/note.md", kind: "file", markdown: true }],
  "/w/Archive": [],
};

function makeHost(overrides: Partial<ExplorerHost> = {}): ExplorerHost & { opened: string[]; watching: Map<string, () => void> } {
  const opened: string[] = [];
  const watching = new Map<string, () => void>();
  return {
    opened,
    watching,
    list: async (path) => {
      const entries = tree[path];
      if (!entries) throw new Error("gone");
      return entries;
    },
    watch: async (path, onChange) => {
      watching.set(path, onChange);
      return () => watching.delete(path);
    },
    openFile: (path) => opened.push(path),
    pickFolder: () => {},
    closeFolder: () => {},
    ...overrides,
  };
}

const labels = (explorer: Explorer) => Array.from(explorer.element.querySelectorAll(".explorer__label")).map((el) => el.textContent);
const row = (explorer: Explorer, path: string) => explorer.element.querySelector<HTMLButtonElement>(`.explorer__row[data-path="${path}"]`)!;

describe("sortEntries", () => {
  it("puts folders first, then files, each by name ignoring case", () => {
    const sorted = sortEntries(tree["/w"]!).map((e) => e.name);
    expect(sorted).toEqual(["Archive", "docs", "logo.png", "readme.md"]);
  });
});

describe("ancestorsWithin", () => {
  it("lists the folders between the root and a file inside it", () => {
    expect(ancestorsWithin("/w", "/w/docs/deep/note.md")).toEqual(["/w/docs", "/w/docs/deep"]);
    expect(ancestorsWithin("/w/", "/w/readme.md")).toEqual([]);
  });
  it("is empty for a file outside the root, including a sibling with the same prefix", () => {
    expect(ancestorsWithin("/w", "/elsewhere/a.md")).toEqual([]);
    expect(ancestorsWithin("/w", "/www/a.md")).toEqual([]);
  });
  it("handles Windows separators", () => {
    expect(ancestorsWithin("C:\\w", "C:\\w\\docs\\a.md")).toEqual(["C:\\w\\docs"]);
  });
});

describe("Explorer", () => {
  it("starts empty and offers to open a folder", () => {
    const pickFolder = vi.fn();
    const explorer = new Explorer(makeHost({ pickFolder }));
    expect(explorer.folder).toBeNull();
    explorer.element.querySelector<HTMLButtonElement>(".explorer__open")!.click();
    expect(pickFolder).toHaveBeenCalledTimes(1);
  });

  it("lists the root, expands folders on demand, and opens Markdown files only", async () => {
    const host = makeHost();
    const explorer = new Explorer(host);
    document.body.appendChild(explorer.element);
    await explorer.setRoot({ path: "/w", name: "w" });
    expect(labels(explorer)).toEqual(["Archive", "docs", "logo.png", "readme.md"]);
    expect(row(explorer, "/w/docs").getAttribute("aria-expanded")).toBe("false");

    row(explorer, "/w/docs").click();
    await flush();
    expect(row(explorer, "/w/docs").getAttribute("aria-expanded")).toBe("true");
    expect(labels(explorer)).toEqual(["Archive", "docs", "deep", "spec.md", "logo.png", "readme.md"]);

    row(explorer, "/w/docs/spec.md").click();
    row(explorer, "/w/logo.png").click();
    expect(host.opened).toEqual(["/w/docs/spec.md"]);
    expect(row(explorer, "/w/logo.png").getAttribute("aria-disabled")).toBe("true");

    row(explorer, "/w/docs").click();
    await flush();
    expect(labels(explorer)).toEqual(["Archive", "docs", "logo.png", "readme.md"]);
  });

  it("reveals the active document by opening the folders down to it", async () => {
    const explorer = new Explorer(makeHost());
    document.body.appendChild(explorer.element);
    Element.prototype.scrollIntoView = vi.fn();
    await explorer.setRoot({ path: "/w", name: "w" });
    await explorer.reveal("/w/docs/deep/note.md");
    expect(row(explorer, "/w/docs").getAttribute("aria-expanded")).toBe("true");
    expect(row(explorer, "/w/docs/deep/note.md").classList.contains("explorer__row--active")).toBe(true);
    await explorer.reveal("/elsewhere/x.md");
    expect(explorer.element.querySelector(".explorer__row--active")).toBeNull();
  });

  it("watches exactly the open folders, non-recursively, and re-lists one when it changes", async () => {
    const entries: Record<string, ExplorerEntry[] | undefined> = { ...tree, "/w/docs": [...tree["/w/docs"]!] };
    const host = makeHost({
      list: async (path) => {
        const list = entries[path];
        if (!list) throw new Error("gone");
        return list;
      },
    });
    const explorer = new Explorer(host);
    document.body.appendChild(explorer.element);
    await explorer.setRoot({ path: "/w", name: "w" });
    expect([...host.watching.keys()]).toEqual(["/w"]);
    await explorer.toggle("/w/docs");
    expect([...host.watching.keys()]).toEqual(["/w", "/w/docs"]);

    entries["/w/docs"] = [{ name: "added.md", path: "/w/docs/added.md", kind: "file", markdown: true }];
    host.watching.get("/w/docs")!();
    await flush();
    expect(labels(explorer)).toContain("added.md");
    expect(labels(explorer)).not.toContain("spec.md");

    // Collapsing stops the watch; a folder that vanished closes itself.
    await explorer.toggle("/w/docs");
    await flush();
    expect([...host.watching.keys()]).toEqual(["/w"]);
    await explorer.toggle("/w/docs");
    delete entries["/w/docs"];
    host.watching.get("/w/docs")!();
    await flush();
    expect(row(explorer, "/w/docs").getAttribute("aria-expanded")).toBe("false");
    expect([...host.watching.keys()]).toEqual(["/w"]);

    await explorer.setRoot(null);
    await flush();
    expect(host.watching.size).toBe(0);
  });

  it("closing the folder goes through the host", async () => {
    const closeFolder = vi.fn();
    const explorer = new Explorer(makeHost({ closeFolder }));
    await explorer.setRoot({ path: "/w", name: "w" });
    explorer.element.querySelector<HTMLButtonElement>(".explorer__close")!.click();
    expect(closeFolder).toHaveBeenCalledTimes(1);
    await explorer.setRoot(null);
    expect(explorer.element.querySelector(".explorer__open")).not.toBeNull();
  });
});

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
}
