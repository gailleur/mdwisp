// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

// The only module that talks to the native shell. Everything else is plain
// DOM code so it can run under jsdom in tests.

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { watch } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";

export const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdown", "mkd"];

export interface ShellDocument {
  path: string;
  name: string;
  dir: string;
  text: string;
  /** True in the App Store sandbox, where the folder may be unreadable. */
  sandboxed: boolean;
}

export function openDocument(path: string): Promise<ShellDocument> {
  return invoke<ShellDocument>("open_document", { path });
}

export interface SavedDocument {
  path: string;
  name: string;
  dir: string;
}

export function saveDocument(path: string, text: string): Promise<SavedDocument> {
  return invoke<SavedDocument>("save_document", { path, text });
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

/** Asks the user for a folder, starting at `defaultPath`. Null if cancelled. */
export async function pickFolder(defaultPath: string): Promise<string | null> {
  const result = await openDialog({ directory: true, multiple: false, defaultPath });
  if (!result) return null;
  return Array.isArray(result) ? (result[0] ?? null) : result;
}

/** Keeps access to a folder the user chose (App Store sandbox). */
export function rememberFolder(path: string): Promise<void> {
  return invoke("remember_folder", { path });
}

export function watchFile(path: string, callback: () => void): Promise<UnlistenFn> {
  return watch(path, () => callback(), { delayMs: 300 });
}

export function setWindowTitle(title: string): Promise<void> {
  return getCurrentWindow().setTitle(title);
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

/** Downloads, verifies and installs the update the last check found, then relaunches. */
export function installUpdate(): Promise<void> {
  return invoke("install_update");
}

export function onUpdateProgress(callback: (progress: UpdateProgress) => void): Promise<UnlistenFn> {
  return listen<UpdateProgress>("update-progress", (event) => callback(event.payload));
}
