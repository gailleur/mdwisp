// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

// The only module that talks to the native shell. Everything else is plain
// DOM code so it can run under jsdom in tests.

import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { watch } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";

import type { Encoding } from "./encoding";

export const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdown", "mkd"];

export interface ShellDocument {
  path: string;
  name: string;
  dir: string;
  text: string;
  /** How the bytes were read; a save writes the same encoding back. */
  encoding: Encoding;
  /** True in the App Store sandbox, where the folder may be unreadable. */
  sandboxed: boolean;
  size: number;
  /** Modification time in milliseconds since the epoch. */
  modified: number;
}

export function openDocument(path: string): Promise<ShellDocument> {
  return invoke<ShellDocument>("open_document", { path });
}

export interface DocumentStat {
  size: number;
  modified: number;
}

/** Size and mtime of a file, to tell our own save from a real change. */
export function statDocument(path: string): Promise<DocumentStat> {
  return invoke<DocumentStat>("stat_document", { path });
}

export interface SavedDocument {
  path: string;
  name: string;
  dir: string;
  size: number;
  modified: number;
}

export function saveDocument(path: string, text: string, encoding: Encoding): Promise<SavedDocument> {
  return invoke<SavedDocument>("save_document", { path, text, encoding });
}

export async function pickSavePath(defaultName: string): Promise<string | null> {
  return saveDialog({
    defaultPath: defaultName,
    filters: [{ name: "Markdown", extensions: MARKDOWN_EXTENSIONS }],
  });
}

export function confirmDiscard(message: string): Promise<boolean> {
  return ask(message, { title: "Unsaved changes", kind: "warning", okLabel: "Discard", cancelLabel: "Cancel" });
}

export type CloseChoice = "save" | "discard" | "cancel";

/** Save / Discard / Cancel for a document with unsaved changes. */
export async function confirmClose(name: string): Promise<CloseChoice> {
  const choice = await invoke<string>("confirm_close", { name });
  return choice === "save" || choice === "discard" ? choice : "cancel";
}

/** `handler` returns false to keep the window open. */
export function onCloseRequested(handler: () => Promise<boolean>): Promise<UnlistenFn> {
  return getCurrentWindow().onCloseRequested(async (event) => {
    if (!(await handler())) event.preventDefault();
  });
}

export function takePendingFiles(): Promise<string[]> {
  return invoke<string[]>("take_pending_files");
}

/** Mirrors a toggle's state into its menu check mark (autosave, outline…). */
export function setMenuChecked(id: string, checked: boolean): void {
  void invoke("set_menu_checked", { id, checked }).catch(() => undefined);
}

export async function printPage(): Promise<void> {
  const handled = await invoke<boolean>("print_page");
  if (!handled) {
    window.print();
  }
}

/** Asks where to save, then writes the current page as a PDF. Null if cancelled. */
export async function exportPdf(defaultName: string): Promise<string | null> {
  const path = await saveDialog({
    defaultPath: defaultName,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!path) return null;
  await invoke("export_pdf", { path });
  return path;
}

export function onOpenFiles(callback: (paths: string[]) => void): Promise<UnlistenFn> {
  return listen<string[]>("open-files", (event) => callback(event.payload));
}

export function onMenu(callback: (id: string) => void): Promise<UnlistenFn> {
  return listen<string>("menu", (event) => callback(event.payload));
}

export function onDrop(callback: (paths: string[]) => void): Promise<UnlistenFn> {
  return getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === "drop") {
      callback(event.payload.paths);
    }
  });
}

export async function pickFiles(): Promise<string[]> {
  const result = await openDialog({
    multiple: true,
    directory: false,
    filters: [{ name: "Markdown", extensions: MARKDOWN_EXTENSIONS }],
  });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

/** Asks the user for a folder, starting at `defaultPath` if given. Null if cancelled. */
export async function pickFolder(defaultPath?: string): Promise<string | null> {
  const result = await openDialog({ directory: true, multiple: false, ...(defaultPath ? { defaultPath } : {}) });
  if (!result) return null;
  return Array.isArray(result) ? (result[0] ?? null) : result;
}

/** Keeps access to a folder the user chose (App Store sandbox). */
export function rememberFolder(path: string): Promise<void> {
  return invoke("remember_folder", { path });
}

export interface ShellFolder {
  path: string;
  name: string;
}

export interface ShellEntry {
  name: string;
  path: string;
  kind: "dir" | "file";
  markdown: boolean;
}

/**
 * Opens a folder for the files sidebar: checks it is readable and grants
 * the webview access to it (kept across launches in the sandbox), and
 * returns its canonical path and name.
 */
export function openFolder(path: string): Promise<ShellFolder> {
  return invoke<ShellFolder>("open_folder", { path });
}

/** Direct children of a folder opened with `openFolder`, hidden entries left out. */
export function listFolder(path: string): Promise<ShellEntry[]> {
  return invoke<ShellEntry[]>("list_folder", { path });
}

export interface FolderIndex {
  /** Paths relative to the folder, with the platform's separator. */
  files: string[];
  /** True when the folder holds more Markdown files than were listed. */
  truncated: boolean;
}

/**
 * Every Markdown file under a folder opened with `openFolder`, for "go to
 * file". Walks the tree on a background thread, within fixed limits.
 */
export function indexFolder(path: string): Promise<FolderIndex> {
  return invoke<FolderIndex>("index_folder", { path });
}

export interface FolderHit {
  line: number;
  text: string;
}

export interface FolderFileHits {
  path: string;
  hits: FolderHit[];
}

export interface FolderSearchSummary {
  files: number;
  hits: number;
  truncated: boolean;
  cancelled: boolean;
}

/** One counter for searches and cancellations: the shell obeys the highest id it has seen. */
let searchSerial = 0;

/**
 * Finds `query` (literal, case ignored) in the Markdown files of an open
 * folder. Files with matches arrive on `onFile` while the search runs.
 * Starting another search stops this one, which then resolves `cancelled`.
 */
export function searchFolder(path: string, query: string, onFile: (file: FolderFileHits) => void): Promise<FolderSearchSummary> {
  const channel = new Channel<FolderFileHits>();
  channel.onmessage = onFile;
  searchSerial += 1;
  return invoke<FolderSearchSummary>("search_folder", { path, query, id: searchSerial, onFile: channel });
}

/** Stops the folder search under way, if any. */
export function cancelSearch(): void {
  searchSerial += 1;
  void invoke("cancel_search", { id: searchSerial }).catch(() => undefined);
}

export function watchFile(path: string, callback: () => void): Promise<UnlistenFn> {
  return watch(path, () => callback(), { delayMs: 300 });
}

/**
 * Fires when a folder's own entries change, batched. Deliberately not
 * recursive: the plugin's debounced watcher indexes every file under a
 * recursive watch before it reports anything, which on a large tree takes
 * seconds and hammers the disk.
 */
export function watchDir(path: string, callback: () => void): Promise<UnlistenFn> {
  return watch(path, () => callback(), { delayMs: 300, recursive: false });
}

export function setWindowTitle(title: string): Promise<void> {
  return getCurrentWindow().setTitle(title);
}

export function minimizeWindow(): Promise<void> {
  return getCurrentWindow().minimize();
}

/** Zoom on macOS, maximize elsewhere: fills the screen, or undoes that. */
export function zoomWindow(): Promise<void> {
  return getCurrentWindow().toggleMaximize();
}

export function assetUrl(path: string): string {
  return convertFileSrc(path);
}

export function openExternal(url: string): Promise<void> {
  return openUrl(url);
}

/** `true` if mdwisp already opens Markdown files; `null` where unknown. */
export function defaultMarkdownAppStatus(): Promise<boolean | null> {
  return invoke<boolean | null>("default_app_status");
}

/** Makes mdwisp the default Markdown app; resolves to a message to show. */
export function makeDefaultMarkdownApp(): Promise<string> {
  return invoke<string>("make_default_app");
}

// Updates. The check is the only network request the app ever makes by
// itself, and only these calls make it; nothing runs at launch or on a timer.

export type UpdateCheck =
  | { kind: "store"; url: string }
  | { kind: "upToDate"; version: string }
  | { kind: "available"; version: string; date: string | null; notes: string | null };

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

/** Fetches the release manifest and compares it with this build. */
export function checkForUpdates(): Promise<UpdateCheck> {
  return invoke<UpdateCheck>("check_update");
}

/**
 * Downloads, verifies and installs the update the last check found, then
 * relaunches with `reopen` (the documents open now) back in place.
 */
export function installUpdate(reopen: string[]): Promise<void> {
  return invoke("install_update", { reopen });
}

export function onUpdateProgress(callback: (progress: UpdateProgress) => void): Promise<UnlistenFn> {
  return listen<UpdateProgress>("update-progress", (event) => callback(event.payload));
}
