// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

// The documents opened most recently, for File ▸ Open Recent. Paths only,
// most recent first, kept in local storage like the rest of the window's
// state. The list is small on purpose: it is a menu, not a history.

export const RECENT_KEY = "mdwisp.recent";
export const RECENT_LIMIT = 10;

export function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (raw === null) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((p): p is string => typeof p === "string" && p.length > 0).slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

export function writeRecent(paths: string[]): void {
  try {
    if (paths.length === 0) localStorage.removeItem(RECENT_KEY);
    else localStorage.setItem(RECENT_KEY, JSON.stringify(paths));
  } catch {
    // Without storage the menu lasts the session.
  }
}

/** `path` moved to the front; the list stays within the limit. */
export function pushRecent(paths: readonly string[], path: string): string[] {
  return [path, ...paths.filter((p) => p !== path)].slice(0, RECENT_LIMIT);
}

export function withoutRecent(paths: readonly string[], path: string): string[] {
  return paths.filter((p) => p !== path);
}

/**
 * Menu labels for the paths: the file's name, and when two share one,
 * the folder it is in as well, so the entries can be told apart.
 */
export function recentLabels(paths: readonly string[]): string[] {
  const names = paths.map((path) => path.split(/[\\/]/).pop() ?? path);
  return names.map((name, index) => {
    if (names.indexOf(name) === names.lastIndexOf(name)) return name;
    const parts = (paths[index] ?? "").split(/[\\/]/);
    const folder = parts.length > 1 ? parts[parts.length - 2] : "";
    return folder ? `${name} — ${folder}` : name;
  });
}
