// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

// What the two left sidebars (files, outline) share: a width that the user
// drags on the right edge, clamped so the panel stays readable and the
// document keeps most of the window.

export const SIDEBAR_DEFAULT_WIDTH = 232;
export const SIDEBAR_MIN_WIDTH = 140;
const SIDEBAR_MAX_WIDTH = 600;

/** Keeps a sidebar readable and leaves room for the document. */
export function clampSidebarWidth(width: number, viewportWidth: number): number {
  const max = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.floor(viewportWidth * 0.6)));
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.round(Math.min(max, Math.max(SIDEBAR_MIN_WIDTH, width)));
}

export interface SidebarOptions {
  className: string;
  label: string;
  /** Called with the new width when a drag on the right edge ends. */
  onResize?: (width: number) => void;
}

/**
 * An `<aside>` with a drag handle on its right edge. Subclasses fill it;
 * this keeps the width (as the `--sidebar-width` custom property) and the
 * drag behaviour, which both sidebars share.
 */
export class Sidebar {
  readonly element: HTMLElement;
  protected readonly handle: HTMLElement;
  private width = SIDEBAR_DEFAULT_WIDTH;
  private readonly onResize: ((width: number) => void) | undefined;

  constructor(options: SidebarOptions) {
    this.onResize = options.onResize;
    this.element = document.createElement("aside");
    this.element.className = `sidebar ${options.className}`;
    this.element.setAttribute("aria-label", options.label);
    this.element.hidden = true;

    this.handle = document.createElement("div");
    this.handle.className = "sidebar__handle";
    this.handle.setAttribute("role", "separator");
    this.handle.setAttribute("aria-orientation", "vertical");
    this.handle.setAttribute("aria-label", `Resize ${options.label.toLowerCase()}`);
    this.handle.title = "Drag to resize";
    this.handle.addEventListener("pointerdown", (event) => this.startDrag(event));
    this.handle.addEventListener("dblclick", () => this.setWidth(SIDEBAR_DEFAULT_WIDTH, true));
    this.applyWidth();
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  setOpen(open: boolean): void {
    this.element.hidden = !open;
  }

  /** Sets the sidebar width in CSS pixels, clamped to what fits. */
  setWidth(width: number, notify = false): void {
    const next = clampSidebarWidth(width, window.innerWidth);
    const changed = next !== this.width;
    this.width = next;
    this.applyWidth();
    if (notify && changed) this.onResize?.(next);
  }

  private applyWidth(): void {
    this.element.style.setProperty("--sidebar-width", `${this.width}px`);
  }

  private startDrag(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = this.handle;
    const startX = event.clientX;
    const startWidth = this.width;
    this.element.classList.add("sidebar--resizing");
    document.body.classList.add("is-resizing");
    handle.setPointerCapture(event.pointerId);

    const move = (e: PointerEvent) => this.setWidth(startWidth + (e.clientX - startX));
    const finish = (e: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      this.element.classList.remove("sidebar--resizing");
      document.body.classList.remove("is-resizing");
      if (this.width !== startWidth) this.onResize?.(this.width);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }
}
