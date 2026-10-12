// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Gailleur. All rights reserved.

import "katex/dist/katex.min.css";
import "./styles.css";

import { FindBar } from "./find";
import { isExternalHref, isMarkdownHref, resolveRelative } from "./render";
import * as shell from "./shell";
import { Tabs, type Tab } from "./tabs";
import { createThemeButton, Theme } from "./theme";

const REMOTE_IMAGES_KEY = "mdwisp.remoteImages";
const ZOOM_STEPS = [0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

function readRemoteImages(): boolean {
  try {
    return localStorage.getItem(REMOTE_IMAGES_KEY) !== "off";
  } catch {
    return true;
  }
}

function writeRemoteImages(allowed: boolean): void {
  try {
    if (allowed) localStorage.removeItem(REMOTE_IMAGES_KEY);
    else localStorage.setItem(REMOTE_IMAGES_KEY, "off");
  } catch {
    // Not persisted; harmless.
  }
}

function showError(message: string): void {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "alert");
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.className = "clipboard-fallback";
  document.body.appendChild(area);
  area.select();
  try {
    if (!document.execCommand("copy")) throw new Error("Copy rejected.");
  } finally {
    area.remove();
  }
}

function boot(): void {
  const strip = document.getElementById("tabs");
  const viewer = document.getElementById("viewer");
  const empty = document.getElementById("empty");
  const emptyOpen = document.getElementById("empty-open");
  if (!strip || !viewer || !empty || !emptyOpen) throw new Error("Shell markup missing.");

  const theme = new Theme();
  const find = new FindBar(viewer);
  let allowRemoteImages = readRemoteImages();
  let zoomIndex = ZOOM_STEPS.indexOf(1);

  const tabs = new Tabs(strip, viewer, {
    load: shell.openDocument,
    watch: shell.watchFile,
    assetUrl: shell.assetUrl,
    theme: () => theme.effective,
    allowRemoteImages: () => allowRemoteImages,
    onActiveChange: (tab: Tab | null) => {
      empty.hidden = tab !== null;
      strip.hidden = tab === null;
      find.setTarget(tab?.article ?? null);
      find.refresh();
      void shell.setWindowTitle(tab ? `${tab.title} — mdwisp` : "mdwisp");
    },
    onError: showError,
  });

  document.body.append(find.element, createThemeButton(theme));
  theme.onChange(() => tabs.retheme());

  const openPicker = async () => tabs.open(await shell.pickFiles());
  emptyOpen.addEventListener("click", () => void openPicker());

  const setZoom = (index: number) => {
    zoomIndex = Math.min(Math.max(index, 0), ZOOM_STEPS.length - 1);
    const zoom = ZOOM_STEPS[zoomIndex] ?? 1;
    (viewer.style as CSSStyleDeclaration & { zoom: string }).zoom = String(zoom);
  };

  const actions: Record<string, () => void> = {
    open: () => void openPicker(),
    reload: () => tabs.reloadActive(),
    print: () => void shell.printPage(),
    "close-tab": () => tabs.closeActive(),
    find: () => find.toggle(),
    "find-next": () => find.step(1),
    "find-prev": () => find.step(-1),
    theme: () => theme.cycle(),
    "remote-images": () => {
      allowRemoteImages = !allowRemoteImages;
      writeRemoteImages(allowRemoteImages);
      showError(allowRemoteImages ? "Remote images: on" : "Remote images: off");
      void tabs.rerenderAll();
    },
    "zoom-in": () => setZoom(zoomIndex + 1),
    "zoom-out": () => setZoom(zoomIndex - 1),
    "zoom-reset": () => setZoom(ZOOM_STEPS.indexOf(1)),
  };

  // Delegated document interactions: links and code-copy buttons.
  viewer.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;

    const copy = target.closest<HTMLButtonElement>("button.code__copy");
    if (copy) {
      event.preventDefault();
      const pre = copy.parentElement;
      const code = pre?.querySelector("code");
      const selection = window.getSelection();
      if (pre && selection && !selection.isCollapsed && pre.contains(selection.anchorNode)) return;
      copyText(code?.textContent ?? "")
        .then(() => flash(copy, "copied"))
        .catch(() => flash(copy, "failed"));
      return;
    }

    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    if (!anchor) return;
    const href = anchor.getAttribute("href") ?? "";
    event.preventDefault();

    if (href.startsWith("#")) {
      const id = decodeURIComponent(href.slice(1));
      const current = tabs.current?.article;
      const heading = current?.querySelector(`[id="${CSS.escape(id)}"]`) ?? current?.querySelector(`a[name="${CSS.escape(id)}"]`);
      heading?.scrollIntoView({ block: "start" });
      return;
    }
    if (isExternalHref(href)) {
      void shell.openExternal(href).catch((error: unknown) => showError(String(error)));
      return;
    }
    const current = tabs.current;
    if (current && isMarkdownHref(href)) {
      const path = resolveRelative(current.dir, href);
      if (path) void tabs.open([path]);
    }
  });

  const flash = (button: HTMLButtonElement, state: "copied" | "failed") => {
    button.dataset["state"] = state;
    button.textContent = state;
    setTimeout(() => {
      button.dataset["state"] = "ready";
      button.textContent = "copy";
    }, 1400);
  };

  // Keyboard fallbacks for when the native menu does not intercept.
  document.addEventListener("keydown", (event) => {
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return;
    const key = event.key.toLowerCase();
    const id =
      key === "f" ? "find" :
      key === "g" ? (event.shiftKey ? "find-prev" : "find-next") :
      key === "o" ? "open" :
      key === "r" ? "reload" :
      key === "w" ? "close-tab" :
      key === "=" || key === "+" ? "zoom-in" :
      key === "-" ? "zoom-out" :
      key === "0" ? "zoom-reset" :
      null;
    if (!id) return;
    event.preventDefault();
    actions[id]?.();
  });

  void shell.onMenu((id) => actions[id]?.());
  void shell.onDrop((paths) => void tabs.open(paths.filter(isMarkdownPath)));
  void shell
    .onOpenFiles((paths) => void tabs.open(paths))
    .then(() => shell.takePendingFiles())
    .then((paths) => tabs.open(paths));

  tabs.open([]); // establishes the empty state
  strip.hidden = true;
}

function isMarkdownPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return shell.MARKDOWN_EXTENSIONS.includes(ext);
}

boot();
