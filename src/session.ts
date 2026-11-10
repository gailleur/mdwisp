// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

// What the window looks like: the open documents in order, which one was
// active, each one's mode and position, and the zoom. Everything else the
// user sets (sidebars, theme, autosave, remote images, window size) is
// already persisted on its own.
//
// Two snapshots are kept in localStorage. One is taken just before an
// in-app update relaunches the app and is consumed by the very next
// launch. The other is kept up to date while the app runs and is what an
// ordinary launch reopens, if the user wants documents reopened.

import type { Mode, Tab, Tabs } from "./tabs";

/** Left by an update for the relaunch that follows; read once. */
export const SESSION_KEY = "mdwisp.relaunch";
/** The window as it last was, for the next ordinary launch. */
export const LAST_SESSION_KEY = "mdwisp.session";

export interface SessionTab {
  path: string;
  mode: Mode;
  /** Reading view: scroll offset. Source: 1-based cursor line. */
  position?: number;
  /** WYSIWYG: text of the block holding the cursor. */
  anchor?: string;
  /** The preview tab (see tabs.ts). */
  preview?: boolean;
}

export interface Session {
  tabs: SessionTab[];
  /** Index into `tabs` of the active document, -1 for none. */
  active: number;
  zoom: number;
}

const MODES: Mode[] = ["view", "wysiwyg", "source"];

/**
 * Restored tabs that have not been shown yet keep the entry they came
 * from, so a snapshot taken before they are shown does not lose their
 * place.
 */
const pending = new WeakMap<Tab, SessionTab>();

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
  const kept = tab.deferred ? pending.get(tab) : undefined;
  if (kept) return { ...kept };
  const entry: SessionTab = { path: tab.path ?? "", mode: tab.mode };
  if (tab.preview) entry.preview = true;
  if (tab.mode === "source" && tab.source) entry.position = tab.source.cursorLine();
  else if (tab.mode === "wysiwyg" && tab.wysiwyg) entry.anchor = tab.wysiwyg.cursorBlockText();
  else if (tab.mode === "view" && scrollTop !== undefined && scrollTop > 0) entry.position = scrollTop;
  return entry;
}

export interface RestoreOptions {
  /** Skip documents that can no longer be opened instead of reporting them. */
  quiet?: boolean;
  /**
   * The `extra` paths are what the user just asked for (a double-click in
   * the file manager): the last of them ends up in front, whether or not
   * it was part of the snapshot. Without this the snapshot's own front
   * tab wins, which is right after an update, where `extra` only repeats
   * the snapshot.
   */
  extraInFront?: boolean;
}

/**
 * Reopens the documents of a snapshot, in order, with their modes and
 * positions, then any `extra` paths not already covered: the files the
 * launch itself was given. Nothing opens twice. Documents that can no
 * longer be opened are skipped, reported through the tabs' usual error
 * path unless `quiet`.
 */
export async function restoreSession(
  session: Session,
  extra: string[],
  { tabs, viewer }: Omit<SessionSurface, "zoom">,
  setZoom: (zoom: number) => void,
  { quiet = false, extraInFront = false }: RestoreOptions = {},
): Promise<void> {
  setZoom(session.zoom);
  // Every file is read at once and only the front document is rendered
  // now; the others render when first shown, each then put back in its
  // place. `opened` stays aligned with `session.tabs`, so `session.active`
  // still points right when a document in between could not be opened.
  const opened = await tabs.restore(
    session.tabs.map((entry) => ({
      path: entry.path,
      mode: entry.mode,
      preview: entry.preview === true,
      place: (tab: Tab) => place(tab, entry, viewer),
    })),
    session.active,
    quiet,
  );
  opened.forEach((tab, index) => {
    const entry = session.tabs[index];
    if (tab?.deferred && entry) pending.set(tab, entry);
  });
  if (extraInFront && extra.length > 0) {
    // Opening a document that is already there brings it forward.
    await tabs.open(extra);
    return;
  }
  const seen = new Set(session.tabs.map((t) => t.path));
  const rest = extra.filter((p) => !seen.has(p));
  if (rest.length) await tabs.open(rest);
  const active = session.active >= 0 ? opened[session.active] : undefined;
  const entry = session.tabs[session.active];
  if (!active || !entry) return;
  tabs.activate(active);
  // The documents share one scroller: opening the later ones moved it, so
  // the front document is put back where it was once it is in front.
  place(active, entry, viewer);
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

export function saveSession(session: Session, key = SESSION_KEY): void {
  try {
    localStorage.setItem(key, JSON.stringify(session));
  } catch {
    // Without storage the relaunch still gets the paths on its command line.
  }
}

/** The snapshot kept for the next ordinary launch, left in place. */
export function readLastSession(): Session | null {
  try {
    const raw = localStorage.getItem(LAST_SESSION_KEY);
    return raw === null ? null : parseSession(raw);
  } catch {
    return null;
  }
}

/** Forgets the snapshot kept for the next launch (reopening was switched off). */
export function forgetLastSession(): void {
  try {
    localStorage.removeItem(LAST_SESSION_KEY);
  } catch {
    // Nothing was stored.
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
    if (t["preview"] === true) entry.preview = true;
    tabs.push(entry);
  }
  const active = typeof obj["active"] === "number" && obj["active"] >= 0 && obj["active"] < tabs.length ? obj["active"] : -1;
  const zoom = typeof obj["zoom"] === "number" && obj["zoom"] > 0 ? obj["zoom"] : 1;
  return { tabs, active, zoom };
}
