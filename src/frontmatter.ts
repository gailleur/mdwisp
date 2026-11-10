// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

// Front matter: the metadata block static-site generators put at the top of
// a document, in YAML (`---`), TOML (`+++`) or JSON (`{ … }`). It is split
// off before the Markdown is parsed and written back exactly as it was
// read, so the reading view never shows it as a rule and a heading, and an
// edit elsewhere in the document never touches it. Text here is LF-only.

export type FrontMatterFormat = "yaml" | "toml" | "json";

export interface FrontMatter {
  format: FrontMatterFormat;
  /**
   * The block as it stands in the file: fences included, and the newline
   * after the closing fence when the document goes on after it.
   */
  raw: string;
  /** Between the fences (YAML, TOML) or the object itself (JSON), without the fence lines. */
  inner: string;
}

export interface SplitDocument {
  matter: FrontMatter | null;
  /** The document after the block; all of it when there is no block. */
  body: string;
}

export interface FrontMatterField {
  /** Empty when the block could not be read as fields and `value` holds it whole. */
  key: string;
  value: string;
}

export const FORMAT_LABEL: Record<FrontMatterFormat, string> = { yaml: "YAML", toml: "TOML", json: "JSON" };

// What the first line of the block must look like for the fences to be
// taken as front matter rather than two thematic breaks around a paragraph.
const YAML_START = /^(#|[A-Za-z0-9_.-]+\s*:)/;
const TOML_START = /^(#|\[|[A-Za-z0-9_."'-]+\s*=)/;

/** Splits a document into its front matter, if any, and the rest. */
export function splitFrontMatter(text: string): SplitDocument {
  const none: SplitDocument = { matter: null, body: text };
  if (text.startsWith("{")) return splitJson(text) ?? none;
  const lines = text.split("\n");
  const fence = (lines[0] ?? "").trimEnd();
  if (fence !== "---" && fence !== "+++") return none;
  const format: FrontMatterFormat = fence === "---" ? "yaml" : "toml";
  for (let i = 1; i < lines.length; i += 1) {
    const line = (lines[i] ?? "").trimEnd();
    if (line !== fence && !(format === "yaml" && line === "...")) continue;
    const inner = lines.slice(1, i).join("\n");
    const start = inner.split("\n").find((l) => l.trim() !== "");
    if (start !== undefined && !(format === "yaml" ? YAML_START : TOML_START).test(start)) return none;
    const closed = i + 1 < lines.length;
    return {
      matter: { format, raw: lines.slice(0, i + 1).join("\n") + (closed ? "\n" : ""), inner },
      body: lines.slice(i + 1).join("\n"),
    };
  }
  return none;
}

/** A JSON object at the very start, ending at a line end, that actually parses. */
function splitJson(text: string): SplitDocument | null {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth > 0) continue;
      const lineEnd = text.indexOf("\n", i + 1);
      const end = lineEnd === -1 ? text.length : lineEnd;
      if (text.slice(i + 1, end).trim() !== "") return null;
      const inner = text.slice(0, i + 1);
      try {
        if (typeof JSON.parse(inner) !== "object") return null;
      } catch {
        return null;
      }
      const closed = lineEnd !== -1;
      return { matter: { format: "json", raw: text.slice(0, closed ? end + 1 : end), inner }, body: text.slice(closed ? end + 1 : end) };
    }
  }
  return null;
}

export function joinFrontMatter(matter: FrontMatter | null, body: string): string {
  return matter ? matter.raw + body : body;
}

/**
 * The block with new contents between its fences. The original bytes come
 * back when nothing changed, so a document edited elsewhere keeps them.
 */
export function withInner(matter: FrontMatter, inner: string): FrontMatter {
  if (inner === matter.inner) return matter;
  const newline = matter.raw.endsWith("\n") ? "\n" : "";
  if (matter.format === "json") return { ...matter, raw: inner + newline, inner };
  const fence = matter.format === "yaml" ? "---" : "+++";
  return { ...matter, raw: `${fence}\n${inner ? `${inner}\n` : ""}${fence}${newline}`, inner };
}

/**
 * The block's top-level fields, read line by line for display: no YAML or
 * TOML parser, so a nested value is shown as the text under its key.
 */
export function frontMatterFields(matter: FrontMatter): FrontMatterField[] {
  if (matter.format === "json") return jsonFields(matter.inner);
  const key = matter.format === "yaml" ? /^([^\s#:][^:]*?)\s*:(?:\s(.*))?$/ : /^([A-Za-z0-9_.-]+|"[^"]*")\s*=\s*(.*)$/;
  const fields: FrontMatterField[] = [];
  for (const line of matter.inner.split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const match = key.exec(line);
    const last = fields[fields.length - 1];
    if (match?.[1] !== undefined) fields.push({ key: unquote(match[1]), value: (match[2] ?? "").trim() });
    else if (matter.format === "toml" && /^\s*\[.*\]\s*$/.test(line)) fields.push({ key: line.trim(), value: "" });
    else if (last) last.value = last.value ? `${last.value}\n${line.trim()}` : line.trim();
    else fields.push({ key: "", value: line.trim() });
  }
  return fields;
}

function jsonFields(inner: string): FrontMatterField[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(inner);
  } catch {
    return [{ key: "", value: inner }];
  }
  if (!parsed || typeof parsed !== "object") return [{ key: "", value: inner }];
  return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
}

/** The `title` field as a plain string, when the block has one. */
export function frontMatterTitle(matter: FrontMatter): string | null {
  const title = frontMatterFields(matter).find((f) => f.key === "title")?.value;
  const text = title ? unquote(title) : "";
  return text || null;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && (trimmed.startsWith('"') || trimmed.startsWith("'")) && trimmed.endsWith(trimmed[0] ?? "")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
