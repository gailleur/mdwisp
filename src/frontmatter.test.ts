// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

import { describe, expect, it } from "vitest";

import { frontMatterFields, frontMatterTitle, joinFrontMatter, splitFrontMatter, withInner } from "./frontmatter";

describe("splitFrontMatter", () => {
  it("splits a YAML block and joins it back byte for byte", () => {
    const text = "---\ntitle: Hello\ndate: 2026-01-02\n---\n\n# Hello\n";
    const { matter, body } = splitFrontMatter(text);
    expect(matter).toEqual({ format: "yaml", raw: "---\ntitle: Hello\ndate: 2026-01-02\n---\n", inner: "title: Hello\ndate: 2026-01-02" });
    expect(body).toBe("\n# Hello\n");
    expect(joinFrontMatter(matter, body)).toBe(text);
  });

  it("accepts TOML fences, the YAML `...` closer, an empty block and a block that is the whole file", () => {
    expect(splitFrontMatter("+++\ntitle = 'x'\n+++\nbody").matter?.format).toBe("toml");
    expect(splitFrontMatter("---\na: 1\n...\nbody")).toEqual({ matter: { format: "yaml", raw: "---\na: 1\n...\n", inner: "a: 1" }, body: "body" });
    expect(splitFrontMatter("---\n---\nbody").matter).toEqual({ format: "yaml", raw: "---\n---\n", inner: "" });
    const whole = splitFrontMatter("---\na: 1\n---");
    expect(whole.matter?.raw).toBe("---\na: 1\n---");
    expect(whole.body).toBe("");
    expect(joinFrontMatter(whole.matter, whole.body)).toBe("---\na: 1\n---");
  });

  it("recognises a JSON object only when it parses and ends its line", () => {
    const text = '{\n  "title": "Hi",\n  "tags": ["a", "b"]\n}\n\ntext\n';
    const { matter, body } = splitFrontMatter(text);
    expect(matter?.format).toBe("json");
    expect(body).toBe("\ntext\n");
    expect(joinFrontMatter(matter, body)).toBe(text);
    expect(splitFrontMatter("{not json}\n\ntext").matter).toBeNull();
    expect(splitFrontMatter('{"a": "}"} trailing\n').matter).toBeNull();
  });

  it("leaves alone a rule, an unterminated block, or fences around prose", () => {
    expect(splitFrontMatter("---\n\nparagraph\n").matter).toBeNull();
    expect(splitFrontMatter("---\ntitle: x\n").matter).toBeNull();
    expect(splitFrontMatter("---\n\nSome prose here.\n\n---\n\nmore").matter).toBeNull();
    expect(splitFrontMatter("# Title\n\n---\na: 1\n---\n").matter).toBeNull();
    expect(splitFrontMatter("").matter).toBeNull();
  });
});

describe("withInner", () => {
  it("returns the original bytes for unchanged contents and rebuilds otherwise", () => {
    const { matter } = splitFrontMatter("---   \na: 1\n...\nbody");
    expect(withInner(matter!, "a: 1")).toBe(matter);
    expect(withInner(matter!, "a: 2").raw).toBe("---\na: 2\n---\n");
    expect(withInner(matter!, "").raw).toBe("---\n---\n");
    const json = splitFrontMatter('{"a": 1}\nbody').matter!;
    expect(withInner(json, '{"a": 2}').raw).toBe('{"a": 2}\n');
    const last = splitFrontMatter("+++\na = 1\n+++").matter!;
    expect(withInner(last, "a = 2").raw).toBe("+++\na = 2\n+++");
  });
});

describe("frontMatterFields", () => {
  it("lists top-level keys and keeps nested text under its key", () => {
    const { matter } = splitFrontMatter("---\ntitle: \"Hello\"\n# comment\ntags:\n  - a\n  - b\ndraft: true\n---\n");
    expect(frontMatterFields(matter!)).toEqual([
      { key: "title", value: '"Hello"' },
      { key: "tags", value: "- a\n- b" },
      { key: "draft", value: "true" },
    ]);
    expect(frontMatterTitle(matter!)).toBe("Hello");
  });

  it("reads TOML assignments and tables, and JSON members", () => {
    const toml = splitFrontMatter('+++\ntitle = "T"\n[extra]\nx = 1\n+++\n').matter!;
    expect(frontMatterFields(toml)).toEqual([{ key: "title", value: '"T"' }, { key: "[extra]", value: "" }, { key: "x", value: "1" }]);
    const json = splitFrontMatter('{"title": "J", "n": 2, "tags": ["a"]}\n').matter!;
    expect(frontMatterFields(json)).toEqual([{ key: "title", value: "J" }, { key: "n", value: "2" }, { key: "tags", value: '["a"]' }]);
    expect(frontMatterTitle(json)).toBe("J");
    expect(frontMatterTitle(splitFrontMatter("---\na: 1\n---\n").matter!)).toBeNull();
  });
});
