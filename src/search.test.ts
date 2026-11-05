// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { leadIn, markMatches, SearchView, splitPath, type SearchFile, type SearchHost, type SearchSummary } from "./search";

const payroll: SearchFile = {
  path: "/w/payroll.md",
  hits: [
    { line: 14, text: "the Invoice for March" },
    { line: 31, text: "invoice no. 7, then another invoice" },
  ],
};
const quarter: SearchFile = { path: "/w/notes/q3.md", hits: [{ line: 8, text: "each invoice is filed" }] };

interface Pending {
  root: string;
  query: string;
  onFile: (file: SearchFile) => void;
  finish: (summary?: Partial<SearchSummary>) => void;
  fail: (error: Error) => void;
}

function makeHost(): SearchHost & { searches: Pending[]; cancels: number; opened: Array<[string, number, string, string]>; exits: number } {
  const host = {
    searches: [] as Pending[],
    cancels: 0,
    opened: [] as Array<[string, number, string, string]>,
    exits: 0,
    search: (root: string, query: string, onFile: (file: SearchFile) => void) =>
      new Promise<SearchSummary>((resolve, reject) => {
        host.searches.push({
          root,
          query,
          onFile,
          finish: (summary = {}) => resolve({ files: 0, hits: 0, truncated: false, cancelled: false, ...summary }),
          fail: reject,
        });
      }),
    cancel: () => {
      host.cancels += 1;
    },
    openHit: (path: string, hit: { line: number; text: string }, query: string) => {
      host.opened.push([path, hit.line, hit.text, query]);
    },
    exit: () => {
      host.exits += 1;
    },
  };
  return host;
}

function mount(host: SearchHost): { view: SearchView; input: HTMLInputElement; status: HTMLElement } {
  const view = new SearchView(host);
  document.body.appendChild(view.element);
  view.setRoot("/w");
  view.setOpen(true);
  return {
    view,
    input: view.element.querySelector<HTMLInputElement>(".search__input")!,
    status: view.element.querySelector<HTMLElement>(".search__status")!,
  };
}

function type(input: HTMLInputElement, text: string): void {
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const key = (target: Element, name: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
const rows = (view: SearchView) => Array.from(view.element.querySelectorAll<HTMLButtonElement>(".search__row"));
const settle = () => Promise.resolve().then(() => Promise.resolve());

describe("markMatches", () => {
  const html = (text: string, query: string) => {
    const div = document.createElement("div");
    div.appendChild(markMatches(text, query));
    return div.innerHTML;
  };

  it("marks every occurrence, ignoring case, and keeps the text as written", () => {
    expect(html("An Invoice, then another invoice.", "invoice")).toBe(
      'An <mark class="search__match">Invoice</mark>, then another <mark class="search__match">invoice</mark>.',
    );
    expect(html("nothing here", "invoice")).toBe("nothing here");
  });

  it("never reads the text as markup", () => {
    expect(html("<b>bold</b> & co", "bold")).toBe('&lt;b&gt;<mark class="search__match">bold</mark>&lt;/b&gt; &amp; co');
  });
});

describe("leadIn", () => {
  it("leaves a line alone when the match is near its start", () => {
    expect(leadIn("the Invoice for March", "invoice")).toBe("the Invoice for March");
    expect(leadIn("no match at all in this rather long line", "invoice")).toBe("no match at all in this rather long line");
  });

  it("starts a few words before a match that sits far to the right", () => {
    expect(leadIn("Entry for month 01. The invoice count was 01.", "invoice")).toBe("…01. The invoice count was 01.");
    expect(leadIn("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaINVOICE", "invoice")).toBe("…aaaaaaaaaaaaINVOICE");
  });
});

describe("splitPath", () => {
  it("gives the file name and its folder relative to the root", () => {
    expect(splitPath("/w", "/w/notes/2024/q3.md")).toEqual({ name: "q3.md", dir: "notes/2024" });
    expect(splitPath("/w/", "/w/readme.md")).toEqual({ name: "readme.md", dir: "" });
    expect(splitPath("C:\\w", "C:\\w\\notes\\q3.md")).toEqual({ name: "q3.md", dir: "notes" });
  });

  it("keeps the whole folder of a file outside the root", () => {
    expect(splitPath("/w", "/elsewhere/a.md")).toEqual({ name: "a.md", dir: "/elsewhere" });
    expect(splitPath("", "/elsewhere/a.md")).toEqual({ name: "a.md", dir: "/elsewhere" });
  });
});

describe("SearchView", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("searches a moment after typing stops, not on every letter", () => {
    const host = makeHost();
    const { input, status } = mount(host);
    type(input, "in");
    type(input, "inv");
    type(input, "invoice");
    expect(host.searches.length).toBe(0);
    vi.advanceTimersByTime(300);
    expect(host.searches.map((s) => [s.root, s.query])).toEqual([["/w", "invoice"]]);
    expect(status.textContent).toBe("searching…");
  });

  it("shows files as they arrive, grouped, with counts and marked matches, then the total", async () => {
    const host = makeHost();
    const { view, input, status } = mount(host);
    type(input, "invoice");
    key(input, "Enter");
    const search = host.searches[0]!;
    search.onFile(payroll);
    expect(status.textContent).toBe("searching… 2 lines in 1 file");
    search.onFile(quarter);
    search.finish({ files: 2, hits: 3 });
    await settle();
    expect(status.textContent).toBe("3 lines in 2 files");

    const files = Array.from(view.element.querySelectorAll(".search__row--file"));
    expect(files.map((f) => f.querySelector(".search__name")?.textContent)).toEqual(["payroll.md", "q3.md"]);
    expect(files.map((f) => f.querySelector(".search__dir")?.textContent)).toEqual(["", "notes"]);
    expect(files.map((f) => f.querySelector(".search__count")?.textContent)).toEqual(["2", "1"]);
    const hits = Array.from(view.element.querySelectorAll(".search__row--hit"));
    expect(hits.map((h) => h.querySelector(".search__line")?.textContent)).toEqual(["14", "31", "8"]);
    expect(hits[1]!.querySelectorAll("mark").length).toBe(2);
  });

  it("ends on the totals even when a file arrives after the summary", async () => {
    const host = makeHost();
    const { view, input, status } = mount(host);
    type(input, "invoice");
    key(input, "Enter");
    const search = host.searches[0]!;
    search.onFile(payroll);
    search.finish({ files: 2, hits: 3 });
    await settle();
    expect(status.textContent).toBe("3 lines in 2 files");
    search.onFile(quarter);
    expect(status.textContent).toBe("3 lines in 2 files");
    expect(view.element.querySelectorAll(".search__row--file").length).toBe(2);
  });

  it("opens the line that is clicked and remembers which one it was", () => {
    const host = makeHost();
    const { view, input } = mount(host);
    type(input, "invoice");
    key(input, "Enter");
    host.searches[0]!.onFile(payroll);
    const hits = view.element.querySelectorAll<HTMLButtonElement>(".search__row--hit");
    hits[1]!.click();
    expect(host.opened).toEqual([["/w/payroll.md", 31, "invoice no. 7, then another invoice", "invoice"]]);
    expect(hits[1]!.classList.contains("search__row--active")).toBe(true);
    hits[0]!.click();
    expect(view.element.querySelectorAll(".search__row--active").length).toBe(1);
  });

  it("drops the answers of a search that typing has replaced", async () => {
    const host = makeHost();
    const { view, input, status } = mount(host);
    type(input, "invoice");
    key(input, "Enter");
    type(input, "filed");
    key(input, "Enter");
    expect(host.searches.length).toBe(2);
    host.searches[0]!.onFile(payroll);
    host.searches[0]!.finish({ cancelled: true });
    await settle();
    expect(rows(view).length).toBe(0);
    expect(status.textContent).toBe("searching…");
    host.searches[1]!.onFile(quarter);
    host.searches[1]!.finish({ files: 1, hits: 1 });
    await settle();
    expect(status.textContent).toBe("1 line in 1 file");
  });

  it("does not search for a single letter, and stops the search under way when the field is cleared", () => {
    const host = makeHost();
    const { view, input, status } = mount(host);
    type(input, "i");
    key(input, "Enter");
    expect(host.searches.length).toBe(0);
    expect(status.textContent).toBe("type 2 letters or more");

    type(input, "invoice");
    key(input, "Enter");
    host.searches[0]!.onFile(payroll);
    const cancels = host.cancels;
    type(input, "");
    vi.advanceTimersByTime(300);
    expect(host.cancels).toBe(cancels + 1);
    expect(rows(view).length).toBe(0);
    expect(status.textContent).toBe("");
  });

  it("says when nothing matched, when a limit was hit, and when the search failed", async () => {
    const host = makeHost();
    const { input, status } = mount(host);
    type(input, "zzz");
    key(input, "Enter");
    host.searches[0]!.finish();
    await settle();
    expect(status.textContent).toBe("no results");

    type(input, "invoice");
    key(input, "Enter");
    host.searches[1]!.onFile(payroll);
    host.searches[1]!.finish({ files: 1, hits: 2, truncated: true });
    await settle();
    expect(status.textContent).toBe("first 2 lines in 1 file; narrow the search for the rest");

    type(input, "broken");
    key(input, "Enter");
    host.searches[2]!.fail(new Error("Not an open folder."));
    await settle();
    expect(status.textContent).toBe("search failed: Not an open folder.");
  });

  it("repeats an unchanged query on Enter but not when typing settles on it again", () => {
    const host = makeHost();
    const { input } = mount(host);
    type(input, "invoice");
    vi.advanceTimersByTime(300);
    type(input, "invoices");
    type(input, "invoice");
    vi.advanceTimersByTime(300);
    expect(host.searches.length).toBe(1);
    key(input, "Enter");
    expect(host.searches.length).toBe(2);
  });

  it("is driven from the keyboard: down into the results, sideways to fold, Escape back out", () => {
    const host = makeHost();
    const { view, input } = mount(host);
    type(input, "invoice");
    key(input, "Enter");
    host.searches[0]!.onFile(payroll);
    host.searches[0]!.onFile(quarter);

    key(input, "ArrowDown");
    const [file, first] = rows(view);
    expect(document.activeElement).toBe(file);
    key(file!, "ArrowDown");
    expect(document.activeElement).toBe(first);
    key(first!, "Enter");
    expect(host.opened[0]?.[1]).toBe(14);

    key(first!, "ArrowLeft");
    expect(document.activeElement).toBe(file);
    key(file!, "ArrowLeft");
    expect(file!.getAttribute("aria-expanded")).toBe("false");
    expect(first!.closest<HTMLElement>(".search__hits")!.hidden).toBe(true);
    key(file!, "ArrowDown");
    expect((document.activeElement as HTMLElement).querySelector(".search__name")?.textContent).toBe("q3.md");
    key(file!, "ArrowRight");
    expect(file!.getAttribute("aria-expanded")).toBe("true");

    file!.focus();
    key(file!, "ArrowUp");
    expect(document.activeElement).toBe(input);
    key(first!, "Escape");
    expect(document.activeElement).toBe(input);
    key(input, "Escape");
    expect(host.exits).toBe(1);
  });

  it("forgets the results when the folder changes, and takes a query handed to it", () => {
    const host = makeHost();
    const { view, input } = mount(host);
    view.focus("invoice");
    expect(input.value).toBe("invoice");
    expect(host.searches.length).toBe(1);
    host.searches[0]!.onFile(payroll);
    view.focus("invoice");
    expect(host.searches.length).toBe(1);

    view.setRoot("/other");
    expect(rows(view).length).toBe(0);
    key(input, "Enter");
    expect(host.searches[1]?.root).toBe("/other");
    view.setRoot(null);
    key(input, "Enter");
    expect(host.searches.length).toBe(2);
  });
});
