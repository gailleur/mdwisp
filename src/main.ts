// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

import "katex/dist/katex.min.css";
import "./styles.css";

import { FindBar } from "./find";
import { BLOCK_LABEL, type FormatKind } from "./format";
import { openHelp, type HelpPanel } from "./help";
import { Outline } from "./outline";
import { openBlockPicker, type Picker } from "./picker";
import { isExternalHref, isMarkdownHref, resolveRelative } from "./render";
import * as shell from "./shell";
import { Tabs, type Mode, type Tab } from "./tabs";
import { createThemeButton, Theme } from "./theme";

const REMOTE_IMAGES_KEY = "mdwisp.remoteImages";
const AUTOSAVE_KEY = "mdwisp.autosave";
const OUTLINE_KEY = "mdwisp.outline";
const ZOOM_STEPS = [0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const MODE_LABEL: Record<Mode, string> = { view: "reading", wysiwyg: "editing", source: "source" };
const MODE_KEY: Record<Mode, string> = { view: "⌘1", wysiwyg: "⌘2", source: "⌘3" };

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

function toast(message: string, isError = false): void {
  const el = document.createElement("div");
  el.className = isError ? "toast toast--error" : "toast";
  el.setAttribute("role", isError ? "alert" : "status");
  el.textContent = message;
  el.addEventListener("click", () => el.remove());
  document.body.appendChild(el);
  setTimeout(() => el.remove(), isError ? 10000 : 3000);
}

function reportError(message: string): void {
  console.error(message);
  toast(message, true);
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

function wordCount(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}

/** Average adult silent reading rate for non-fiction (Brysbaert, 2019). */
const WORDS_PER_MINUTE = 238;

export function readingTime(words: number): string {
  if (words === 0) return "0 min";
  const minutes = words / WORDS_PER_MINUTE;
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Shortens a path for the status bar, keeping the file name end intact. */
function displayPath(path: string, max = 60): string {
  const short = path.replace(/^\/Users\/[^/]+\//, "~/").replace(/^\/home\/[^/]+\//, "~/").replace(/^[A-Z]:\\Users\\[^\\]+\\/i, "~\\");
  if (short.length <= max) return short;
  const sep = short.includes("\\") ? "\\" : "/";
  const parts = short.split(sep);
  let out = parts.pop() ?? short;
  while (parts.length && out.length + parts[parts.length - 1]!.length + 1 <= max - 2) {
    out = `${parts.pop()}${sep}${out}`;
  }
  return `…${sep}${out}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** A one-line inline prompt anchored above the status bar. Resolves null on cancel. */
function promptInline(label: string, placeholder: string): Promise<string | null> {
  return new Promise((resolve) => {
    const box = el("form", "prompt");
    const text = el("span", "prompt__label", label);
    const input = el("input", "prompt__input");
    input.type = "text";
    input.placeholder = placeholder;
    input.spellcheck = false;
    box.append(text, input);
    const done = (value: string | null) => {
      box.remove();
      resolve(value);
    };
    box.addEventListener("submit", (event) => {
      event.preventDefault();
      done(input.value.trim() || null);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") done(null);
    });
    input.addEventListener("blur", () => setTimeout(() => box.isConnected && done(null), 120));
    document.body.appendChild(box);
    input.focus();
  });
}

function boot(): void {
  const strip = document.getElementById("tabs");
  const body = document.getElementById("body");
  const viewer = document.getElementById("viewer");
  const empty = document.getElementById("empty");
  const emptyOpen = document.getElementById("empty-open");
  const emptyNew = document.getElementById("empty-new");
  const status = document.getElementById("status");
  if (!strip || !body || !viewer || !empty || !emptyOpen || !emptyNew || !status) throw new Error("Shell markup missing.");

  const isMac = /Mac/i.test(navigator.platform);
  if (isMac) document.documentElement.classList.add("is-mac");

  const theme = new Theme();
  const find = new FindBar(viewer);
  const outline = new Outline();
  body.prepend(outline.element);
  let allowRemoteImages = readFlag(REMOTE_IMAGES_KEY, true);
  let autosave = readFlag(AUTOSAVE_KEY, false);
  let outlineOpen = readFlag(OUTLINE_KEY, false);
  let zoomIndex = ZOOM_STEPS.indexOf(1);

  // Status bar: outline · mode · block · path · (spacer) · words · eol · theme
  const outlineButton = el("button", "status__button", "☰");
  outlineButton.type = "button";
  outlineButton.title = "Outline (⌘⌥S)";
  const modeButton = el("button", "status__button status__button--mode");
  modeButton.type = "button";
  const blockButton = el("button", "status__button status__button--block");
  blockButton.type = "button";
  blockButton.title = "Block type — click to change";
  const pathItem = el("span", "status__item status__path");
  const wordsItem = el("span", "status__item");
  const eolItem = el("span", "status__item");
  status.append(outlineButton, modeButton, blockButton, pathItem, el("span", "status__spacer"), wordsItem, eolItem, createThemeButton(theme));

  let picker: Picker | null = null;
  const closePopup = () => {
    picker?.close();
    picker = null;
  };

  let help: HelpPanel | null = null;
  const toggleHelp = () => {
    if (help) {
      help.close();
      return;
    }
    closePopup();
    help = openHelp(isMac, {
      onClose: () => {
        help = null;
      },
      openLink: (url) => {
        void shell.openExternal(url).catch((error: unknown) => reportError(String(error)));
      },
    });
  };

  const refreshOutline = (tab: Tab | null) => {
    if (!outlineOpen) return;
    outline.setEntries(tab ? tabs.outlineOf(tab) : []);
    if (tab) outline.setActive(tabs.activeOutlineIndex(tab));
  };

  const refreshCursorState = () => {
    const tab = tabs.current;
    if (!tab) return;
    const type = tabs.blockTypeOf(tab);
    blockButton.hidden = type === null;
    if (type) blockButton.textContent = BLOCK_LABEL[type];
    if (outlineOpen) outline.setActive(tabs.activeOutlineIndex(tab));
  };

  const reflect = (tab: Tab | null) => {
    empty.hidden = tab !== null;
    status.hidden = tab === null;
    outline.setOpen(outlineOpen && tab !== null);
    closePopup();
    if (tab) {
      modeButton.textContent = `${MODE_LABEL[tab.mode]} ${MODE_KEY[tab.mode]}`;
      modeButton.title = "Click to cycle reading → editor → source";
      pathItem.textContent = tab.path ? displayPath(tab.path) : "unsaved";
      pathItem.title = tab.path ?? "";
      const words = wordCount(tabs.textOf(tab));
      wordsItem.textContent = `${words} words · ${readingTime(words)}`;
      wordsItem.title = `Reading time at ${WORDS_PER_MINUTE} words per minute`;
      eolItem.textContent = tab.baseline.eol === "\r\n" ? "CRLF" : "LF";
      find.setTarget(tab.article, tab.mode === "wysiwyg");
      find.refresh();
    } else {
      find.setTarget(null);
    }
    refreshOutline(tab);
    refreshCursorState();
    const name = tab ? (tab.mode === "view" ? tab.title : tab.name) : null;
    void shell.setWindowTitle(name ? `${tab?.dirty ? "• " : ""}${name} — mdwisp` : "mdwisp");
  };

  let outlineTimer: number | null = null;
  const scheduleOutline = () => {
    if (!outlineOpen) return;
    if (outlineTimer) window.clearTimeout(outlineTimer);
    outlineTimer = window.setTimeout(() => {
      outlineTimer = null;
      refreshOutline(tabs.current);
    }, 350);
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
    onEdit: scheduleOutline,
    onError: reportError,
  });

  const toggleOutline = () => {
    outlineOpen = !outlineOpen;
    writeFlag(OUTLINE_KEY, outlineOpen);
    reflect(tabs.current);
  };
  outlineButton.addEventListener("click", toggleOutline);
  modeButton.addEventListener("click", () => tabs.cycleMode());

  blockButton.addEventListener("click", () => {
    if (picker && picker.element.isConnected) {
      closePopup();
      return;
    }
    const tab = tabs.current;
    if (!tab) return;
    picker = openBlockPicker(blockButton, tabs.blockTypeOf(tab), (kind) => {
      picker = null;
      tabs.format(kind);
      refreshCursorState();
      scheduleOutline();
    });
  });

  document.body.append(find.element);
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

  const applyFormat = async (kind: FormatKind) => {
    const tab = tabs.current;
    if (!tab) return;
    if (tab.mode === "view") {
      toast("switch to the editor (⌘2) or source (⌘3) to format");
      return;
    }
    if (kind === "link") {
      const href = await promptInline("link", "https://");
      if (href) tabs.format("link", href);
      return;
    }
    tabs.format(kind);
    refreshCursorState();
    scheduleOutline();
  };

  // PDF export always renders the reading view: that is "the document", not
  // whichever editor happens to be mounted.
  const exportPdf = async () => {
    const tab = tabs.current;
    if (!tab) return;
    if (tab.mode !== "view") await tabs.setMode("view");
    const name = `${tab.name.replace(/\.[^.]+$/, "") || "document"}.pdf`;
    try {
      const path = await shell.exportPdf(name);
      if (path) toast(`pdf: ${displayPath(path)}`);
    } catch (error) {
      reportError(`PDF export failed: ${String(error)}`);
    }
  };

  const actions: Record<string, () => void> = {
    new: () => void tabs.newDocument(),
    open: () => void openPicker(),
    save: () => void tabs.save(),
    "save-as": () => void tabs.save(tabs.current, true),
    autosave: () => {
      autosave = !autosave;
      writeFlag(AUTOSAVE_KEY, autosave);
      toast(autosave ? "autosave: on" : "autosave: off");
    },
    reload: () => tabs.reloadActive(),
    print: () => void shell.printPage(),
    "export-pdf": () => void exportPdf(),
    "close-tab": () => tabs.closeActive(),
    find: () => findAction(0),
    "find-next": () => findAction(1),
    "find-prev": () => findAction(-1),
    "mode-view": () => void tabs.setMode("view"),
    "mode-wysiwyg": () => void tabs.setMode("wysiwyg"),
    "mode-source": () => void tabs.setMode("source"),
    outline: toggleOutline,
    help: toggleHelp,
    theme: () => theme.cycle(),
    "remote-images": () => {
      allowRemoteImages = !allowRemoteImages;
      writeFlag(REMOTE_IMAGES_KEY, allowRemoteImages);
      toast(allowRemoteImages ? "remote images: on" : "remote images: off");
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
      const heading = article?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`) ?? article?.querySelector<HTMLElement>(`a[name="${CSS.escape(id)}"]`);
      if (heading) viewer.scrollTop = heading.offsetTop - 24;
      return;
    }
    if (isExternalHref(href)) {
      void shell.openExternal(href).catch((error: unknown) => reportError(String(error)));
      return;
    }
    const current = tabs.current;
    if (current?.dir && isMarkdownHref(href)) {
      const path = resolveRelative(current.dir, href);
      if (path) void tabs.open([path]);
    }
  });

  // Current-section tracking: scroll in reading view, caret in editors.
  let scrollTick = false;
  viewer.addEventListener("scroll", () => {
    if (scrollTick || !outlineOpen) return;
    scrollTick = true;
    requestAnimationFrame(() => {
      scrollTick = false;
      const tab = tabs.current;
      if (tab?.mode === "view") outline.setActive(tabs.activeOutlineIndex(tab));
    });
  });
  document.addEventListener("selectionchange", () => {
    const tab = tabs.current;
    if (tab && tab.mode !== "view") refreshCursorState();
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
    if (event.altKey && /^[0-6]$/.test(key)) {
      event.preventDefault();
      void applyFormat(key === "0" ? "paragraph" : (`h${key}` as FormatKind));
      return;
    }
    if (event.altKey && key === "s") {
      event.preventDefault();
      toggleOutline();
      return;
    }
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
      key === "/" ? "help" :
      key === "e" && event.shiftKey ? "export-pdf" :
      null;
    if (!id) return;
    event.preventDefault();
    actions[id]?.();
  });

  void shell.onMenu((id) => {
    if (id.startsWith("fmt-")) void applyFormat(id.slice(4) as FormatKind);
    else actions[id]?.();
  });
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
