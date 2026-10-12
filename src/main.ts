// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Gailleur. All rights reserved.

import "katex/dist/katex.min.css";
import "./styles.css";

import { FindBar } from "./find";
import { isExternalHref, isMarkdownHref, resolveRelative } from "./render";
import * as shell from "./shell";
import { Tabs, type Mode, type Tab } from "./tabs";
import { createThemeButton, Theme } from "./theme";

const REMOTE_IMAGES_KEY = "mdwisp.remoteImages";
const AUTOSAVE_KEY = "mdwisp.autosave";
const ZOOM_STEPS = [0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

function readFlag(key: string, defaultValue: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? defaultValue : value === "on";
  } catch {
    return defaultValue;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "on" : "off");
  } catch {
    // Not persisted; harmless.
  }
}

function toast(message: string): void {
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
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

const MODE_LABEL: Record<Mode, string> = { view: "reading", wysiwyg: "editing", source: "source" };

function boot(): void {
  const strip = document.getElementById("tabs");
  const viewer = document.getElementById("viewer");
  const empty = document.getElementById("empty");
  const emptyOpen = document.getElementById("empty-open");
  const emptyNew = document.getElementById("empty-new");
  if (!strip || !viewer || !empty || !emptyOpen || !emptyNew) throw new Error("Shell markup missing.");

  const theme = new Theme();
  const find = new FindBar(viewer);
  let allowRemoteImages = readFlag(REMOTE_IMAGES_KEY, true);
  let autosave = readFlag(AUTOSAVE_KEY, false);
  let zoomIndex = ZOOM_STEPS.indexOf(1);

  const modePill = document.createElement("button");
  modePill.type = "button";
  modePill.className = "mode";
  modePill.hidden = true;
  modePill.title = "Switch mode (⌘1 reading, ⌘2 editor, ⌘3 source)";

  const reflect = (tab: Tab | null) => {
    empty.hidden = tab !== null;
    strip.hidden = tab === null;
    modePill.hidden = tab === null;
    if (tab) {
      modePill.textContent = MODE_LABEL[tab.mode];
      modePill.dataset["mode"] = tab.mode;
      find.setTarget(tab.article, tab.mode === "wysiwyg");
      find.refresh();
    } else {
      find.setTarget(null);
    }
    const name = tab ? (tab.mode === "view" ? tab.title : tab.name) : null;
    void shell.setWindowTitle(name ? `${tab?.dirty ? "• " : ""}${name} — mdwisp` : "mdwisp");
  };

  const tabs = new Tabs(strip, viewer, {
    load: shell.openDocument,
    save: shell.saveDocument,
    pickSavePath: shell.pickSavePath,
    confirmDiscard: shell.confirmDiscard,
    watch: shell.watchFile,
    assetUrl: shell.assetUrl,
    theme: () => theme.effective,
    allowRemoteImages: () => allowRemoteImages,
    autosave: () => autosave,
    onActiveChange: reflect,
    onTabStateChange: (tab) => {
      if (tab === tabs.current) reflect(tab);
    },
    onError: toast,
  });

  modePill.addEventListener("click", () => tabs.cycleMode());
  document.body.append(find.element, modePill, createThemeButton(theme));
  theme.onChange(() => tabs.retheme());

  const openPicker = async () => tabs.open(await shell.pickFiles());
  emptyOpen.addEventListener("click", () => void openPicker());
  emptyNew.addEventListener("click", () => void tabs.newDocument());

  const setZoom = (index: number) => {
    zoomIndex = Math.min(Math.max(index, 0), ZOOM_STEPS.length - 1);
    (viewer.style as CSSStyleDeclaration & { zoom: string }).zoom = String(ZOOM_STEPS[zoomIndex] ?? 1);
  };

  const findAction = (step: 0 | 1 | -1) => {
    const tab = tabs.current;
    if (tab?.mode === "source" && tab.source) {
      tab.source.openSearch();
      return;
    }
    if (tab?.mode === "wysiwyg" && find.requiresDomMutation) {
      toast("Find in the editor needs a newer webview; use reading or source mode.");
      return;
    }
    if (step === 0) find.toggle();
    else find.step(step);
  };

  const actions: Record<string, () => void> = {
    new: () => void tabs.newDocument(),
    open: () => void openPicker(),
    save: () => void tabs.save(),
    "save-as": () => void tabs.save(tabs.current, true),
    autosave: () => {
      autosave = !autosave;
      writeFlag(AUTOSAVE_KEY, autosave);
      toast(autosave ? "Autosave: on" : "Autosave: off");
    },
    reload: () => tabs.reloadActive(),
    print: () => void shell.printPage(),
    "close-tab": () => tabs.closeActive(),
    find: () => findAction(0),
    "find-next": () => findAction(1),
    "find-prev": () => findAction(-1),
    "mode-view": () => void tabs.setMode("view"),
    "mode-wysiwyg": () => void tabs.setMode("wysiwyg"),
    "mode-source": () => void tabs.setMode("source"),
    theme: () => theme.cycle(),
    "remote-images": () => {
      allowRemoteImages = !allowRemoteImages;
      writeFlag(REMOTE_IMAGES_KEY, allowRemoteImages);
      toast(allowRemoteImages ? "Remote images: on" : "Remote images: off");
      void tabs.rerenderAll();
    },
    "zoom-in": () => setZoom(zoomIndex + 1),
    "zoom-out": () => setZoom(zoomIndex - 1),
    "zoom-reset": () => setZoom(ZOOM_STEPS.indexOf(1)),
  };

  // Delegated reading-view interactions: links and code-copy buttons.
  viewer.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (tabs.current?.mode !== "view") return;

    const copy = target.closest<HTMLButtonElement>("button.code__copy");
    if (copy) {
      event.preventDefault();
      const pre = copy.parentElement;
      const selection = window.getSelection();
      if (pre && selection && !selection.isCollapsed && pre.contains(selection.anchorNode)) return;
      copyText(pre?.querySelector("code")?.textContent ?? "")
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
      const article = tabs.current?.article;
      const heading = article?.querySelector(`[id="${CSS.escape(id)}"]`) ?? article?.querySelector(`a[name="${CSS.escape(id)}"]`);
      heading?.scrollIntoView({ block: "start" });
      return;
    }
    if (isExternalHref(href)) {
      void shell.openExternal(href).catch((error: unknown) => toast(String(error)));
      return;
    }
    const current = tabs.current;
    if (current?.dir && isMarkdownHref(href)) {
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
      key === "n" ? "new" :
      key === "o" ? "open" :
      key === "s" ? (event.shiftKey ? "save-as" : "save") :
      key === "r" ? "reload" :
      key === "w" ? "close-tab" :
      key === "1" ? "mode-view" :
      key === "2" ? "mode-wysiwyg" :
      key === "3" ? "mode-source" :
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
  void shell.onCloseRequested(() => tabs.confirmCloseAll());
  void shell
    .onOpenFiles((paths) => void tabs.open(paths))
    .then(() => shell.takePendingFiles())
    .then((paths) => tabs.open(paths));

  reflect(null);
}

function isMarkdownPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return shell.MARKDOWN_EXTENSIONS.includes(ext);
}

boot();
