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

/** `handler` returns false to keep the window open. */
export function onCloseRequested(handler: () => Promise<boolean>): Promise<UnlistenFn> {
  return getCurrentWindow().onCloseRequested(async (event) => {
    if (!(await handler())) event.preventDefault();
  });
}

export function takePendingFiles(): Promise<string[]> {
  return invoke<string[]>("take_pending_files");
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
