// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

// What the window looks like, captured just before an in-app update
// relaunches the app and put back once the new version starts: the open
// documents in order, which one was active, each one's mode and position,
// and the zoom. Everything else the user sets (outline, theme, autosave,
// remote images, window size) is already persisted on its own.
//
// The snapshot lives in localStorage under one key and is consumed by the
// very next launch, so a normal start never sees it.

import type { Mode, Tab, Tabs } from "./tabs";

export const SESSION_KEY = "mdwisp.relaunch";

export interface SessionTab {
  path: string;
  mode: Mode;
  /** Reading view: scroll offset. Source: 1-based cursor line. */
  position?: number;
  /** WYSIWYG: text of the block holding the cursor. */
  anchor?: string;
}

export interface Session {
  tabs: SessionTab[];
  /** Index into `tabs` of the active document, -1 for none. */
  active: number;
  zoom: number;
}

const MODES: Mode[] = ["view", "wysiwyg", "source"];

export interface SessionSurface {
  tabs: Tabs;
  /** The scrolling element behind the reading view. */
  viewer: HTMLElement;
  zoom: () => number;
}

/** Snapshot of the open documents. Untitled documents have no path and are left out. */
export function captureSession({ tabs, viewer, zoom }: SessionSurface): Session {
  const current = tabs.current;
  const entries: SessionTab[] = [];
  let active = -1;
  for (const tab of tabs.all) {
    if (!tab.path) continue;
    if (tab === current) active = entries.length;
    entries.push(describe(tab, tab === current ? viewer.scrollTop : undefined));
  }
  return { tabs: entries, active, zoom: zoom() };
}

function describe(tab: Tab, scrollTop: number | undefined): SessionTab {
  const entry: SessionTab = { path: tab.path ?? "", mode: tab.mode };
  if (tab.mode === "source" && tab.source) entry.position = tab.source.cursorLine();
  else if (tab.mode === "wysiwyg" && tab.wysiwyg) entry.anchor = tab.wysiwyg.cursorBlockText();
  else if (tab.mode === "view" && scrollTop !== undefined && scrollTop > 0) entry.position = scrollTop;
  return entry;
}

/**
 * Reopens the documents of a snapshot, in order, with their modes and
 * positions, then any `extra` paths not already covered (the command line
 * of the relaunch names the same files; this keeps the two in step without
 * opening anything twice). Documents that no longer exist are reported
 * through the tabs' usual error path and skipped.
 */
export async function restoreSession(
  session: Session,
  extra: string[],
  { tabs, viewer }: Omit<SessionSurface, "zoom">,
  setZoom: (zoom: number) => void,
): Promise<void> {
  setZoom(session.zoom);
  // Aligned with `session.tabs`, so `session.active` still points right
  // when a document in between could not be opened.
  const opened: Array<Tab | undefined> = [];
  for (const entry of session.tabs) {
    await tabs.open([entry.path]);
    const tab = tabs.current;
    if (!tab || tab.path !== entry.path) {
      opened.push(undefined);
      continue;
    }
    opened.push(tab);
    if (entry.mode !== "view") await tabs.setMode(entry.mode);
    place(tab, entry, viewer);
  }
  const seen = new Set(session.tabs.map((t) => t.path));
  const rest = extra.filter((p) => !seen.has(p));
  if (rest.length) await tabs.open(rest);
  const active = session.active >= 0 ? opened[session.active] : undefined;
  if (active) tabs.activate(active);
}

function place(tab: Tab, entry: SessionTab, viewer: HTMLElement): void {
  if (entry.mode === "source" && tab.source && entry.position) {
    tab.source.goToLine(entry.position);
  } else if (entry.mode === "wysiwyg" && tab.wysiwyg && entry.anchor) {
    tab.wysiwyg.selectBlockContaining(entry.anchor);
  } else if (entry.mode === "view" && entry.position) {
    const top = entry.position;
    const restore = () => {
      viewer.scrollTop = top;
    };
    restore();
    // Images and fonts settle a frame or two later; repeat once they have.
    requestAnimationFrame(() => requestAnimationFrame(restore));
  }
}

export function saveSession(session: Session): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Without storage the relaunch still gets the paths on its command line.
  }
}

/** Reads and clears the snapshot left by the previous process, if any. */
export function takeSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw === null) return null;
    localStorage.removeItem(SESSION_KEY);
    return parseSession(raw);
  } catch {
    return null;
  }
}

export function parseSession(raw: string): Session | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj["tabs"])) return null;
  const tabs: SessionTab[] = [];
  for (const item of obj["tabs"] as unknown[]) {
    if (!item || typeof item !== "object") continue;
    const t = item as Record<string, unknown>;
    if (typeof t["path"] !== "string" || !t["path"]) continue;
    const mode = MODES.includes(t["mode"] as Mode) ? (t["mode"] as Mode) : "view";
    const entry: SessionTab = { path: t["path"], mode };
    if (typeof t["position"] === "number" && Number.isFinite(t["position"]) && t["position"] > 0) entry.position = t["position"];
    if (typeof t["anchor"] === "string" && t["anchor"]) entry.anchor = t["anchor"];
    tabs.push(entry);
  }
  const active = typeof obj["active"] === "number" && obj["active"] >= 0 && obj["active"] < tabs.length ? obj["active"] : -1;
  const zoom = typeof obj["zoom"] === "number" && obj["zoom"] > 0 ? obj["zoom"] : 1;
  return { tabs, active, zoom };
}
