// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Gailleur Labs. All rights reserved.

export type ThemeMode = "auto" | "light" | "dark";
export type EffectiveTheme = "light" | "dark";

const STORAGE_KEY = "mdwisp.theme";
const ORDER: ThemeMode[] = ["auto", "light", "dark"];

function read(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "auto";
  } catch {
    return "auto";
  }
}

function write(mode: ThemeMode): void {
  try {
    if (mode === "auto") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Storage may be unavailable; the choice simply does not persist.
  }
}

export class Theme {
  private mode: ThemeMode = read();
  private readonly listeners = new Set<(theme: EffectiveTheme) => void>();
  private readonly media = window.matchMedia("(prefers-color-scheme: dark)");

  constructor() {
    this.apply();
    this.media.addEventListener("change", () => {
      if (this.mode === "auto") this.notify();
    });
  }

  get current(): ThemeMode {
    return this.mode;
  }

  get effective(): EffectiveTheme {
    if (this.mode !== "auto") return this.mode;
    return this.media.matches ? "dark" : "light";
  }

  set(mode: ThemeMode): void {
    this.mode = mode;
    write(mode);
    this.apply();
    this.notify();
  }

  cycle(): void {
    const next = ORDER[(ORDER.indexOf(this.mode) + 1) % ORDER.length] ?? "auto";
    this.set(next);
  }

  onChange(listener: (theme: EffectiveTheme) => void): void {
    this.listeners.add(listener);
  }

  private apply(): void {
    const root = document.documentElement;
    if (this.mode === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", this.mode);
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.effective);
  }
}

/** A status-bar button showing the theme mode; click cycles it. */
export function createThemeButton(theme: Theme): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "status__button";

  const update = () => {
    const glyph: Record<ThemeMode, string> = { auto: "◐", light: "○", dark: "●" };
    button.textContent = `${glyph[theme.current]} ${theme.current}`;
    button.title = `Theme: ${theme.current} (⌘⇧D cycles)`;
    button.setAttribute("aria-label", `Theme: ${theme.current}; click to change`);
  };

  button.addEventListener("click", () => theme.cycle());
  theme.onChange(update);
  update();
  return button;
}
