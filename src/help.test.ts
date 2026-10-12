// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

import { beforeEach, describe, expect, it, vi } from "vitest";

import { helpSections, keysFor, openHelp } from "./help";

describe("keysFor", () => {
  it("keeps Mac glyphs on Mac and spells them out elsewhere", () => {
    expect(keysFor("⌘⇧S", true)).toBe("⌘⇧S");
    expect(keysFor("⌘⇧S", false)).toBe("Ctrl+Shift+S");
    expect(keysFor("⌘⌥2", false)).toBe("Ctrl+Alt+2");
  });
});

describe("helpSections", () => {
  it("covers files, view, format and limits", () => {
    const titles = helpSections(true).map((s) => s.title);
    expect(titles).toEqual(["files", "view", "format (editor and source)", "limits"]);
  });

  it("documents the Mermaid and math limit and the no-network promise", () => {
    const limits = helpSections(true).find((s) => s.title === "limits")?.notes?.join("\n") ?? "";
    expect(limits).toMatch(/Mermaid/);
    expect(limits).toMatch(/no update checks, no telemetry/);
  });
});

describe("openHelp", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts a dialog with every shortcut row", () => {
    const help = openHelp(true);
    expect(help.element.getAttribute("role")).toBe("dialog");
    const rows = helpSections(true).flatMap((s) => s.rows ?? []);
    expect(help.element.querySelectorAll(".help__rows dt").length).toBe(rows.length);
    help.close();
    expect(document.body.contains(help.element)).toBe(false);
  });

  it("closes on Escape, on the close button and on the backdrop, once", () => {
    const onClose = vi.fn();
    const a = openHelp(false, onClose);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.body.contains(a.element)).toBe(false);

    const b = openHelp(false, onClose);
    b.element.querySelector<HTMLButtonElement>(".help__close")!.click();
    expect(document.body.contains(b.element)).toBe(false);

    const c = openHelp(false, onClose);
    c.element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(document.body.contains(c.element)).toBe(false);
    c.close();
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
