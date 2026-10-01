// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import { type OutFormat, parseOutFlags, renderRecords, renderTable } from "./emit";

describe("parseOutFlags", () => {
  test("strips flags, order independent", () => {
    expect(parseOutFlags(["status", "--json"])).toEqual({ format: "json", rest: ["status"] });
    expect(parseOutFlags(["--toml", "status"])).toEqual({ format: "toml", rest: ["status"] });
    expect(parseOutFlags(["--emoji"])).toEqual({ format: "emoji", rest: [] });
  });

  test("no flag -> human, rest unchanged", () => {
    const { format, rest } = parseOutFlags(["list", "--verbose"]);
    expect(format).toBe<OutFormat>("human");
    expect(rest).toEqual(["list", "--verbose"]);
  });

  test("multi-flag precedence json > toml > emoji", () => {
    expect(parseOutFlags(["--toml", "--json"]).format).toBe("json");
    expect(parseOutFlags(["--emoji", "--toml"]).format).toBe("toml");
    expect(parseOutFlags(["--emoji", "--json", "--toml"]).format).toBe("json");
  });

  test("exact flag match only — prefixed flags not eaten", () => {
    expect(parseOutFlags(["--jsonl"]).format).toBe("human");
    expect(parseOutFlags(["--jsonl"]).rest).toEqual(["--jsonl"]);
    expect(parseOutFlags(["--tomlify"]).rest).toEqual(["--tomlify"]);
    expect(parseOutFlags(["--emojify"]).rest).toEqual(["--emojify"]);
  });

  test("flags stripped anywhere — bare -- not special", () => {
    expect(parseOutFlags(["--", "--json"])).toEqual({ format: "json", rest: ["--"] });
  });
});

describe("renderRecords json", () => {
  test("compact, arrays stay arrays, parse-back equality", () => {
    const records = [
      { name: "wt-a", sha: "abc123", clean: true, count: 3 },
      { name: "wt-b", sha: "def456", clean: false, count: 0 },
    ];
    const out = renderRecords(records, "json", { emoji: () => "" });
    expect(out).not.toContain("\n");
    expect(out).not.toContain("  ");
    expect(JSON.parse(out)).toEqual(records);
  });

  test("scalar as-is", () => {
    expect(renderRecords(42, "json", { emoji: () => "" })).toBe("42");
    expect(renderRecords("x", "json", { emoji: () => "" })).toBe("\"x\"");
  });
});

describe("renderRecords toml", () => {
  test("array of flat records round-trips via items", () => {
    const records = [
      { name: "wt-a", count: 3, clean: true },
      { name: "wt-b", count: 0, clean: false },
    ];
    const out = renderRecords(records, "toml", { emoji: () => "" });
    const parsed = Bun.TOML.parse(out) as {
      items: Array<{ name: string; count: number; clean: boolean; }>;
    };
    expect(parsed.items).toEqual(records);
  });

  test("single scalar wraps as value", () => {
    const out = renderRecords("hello", "toml", { emoji: () => "" });
    expect((Bun.TOML.parse(out) as { value: string; }).value).toBe("hello");
  });

  test("empty array -> empty string", () => {
    expect(renderRecords([], "toml", { emoji: () => "" })).toBe("");
  });
});

describe("renderRecords emoji", () => {
  test("one line per record, empty -> empty", () => {
    const records = [{ name: "a" }, { name: "b" }, { name: "c" }];
    const out = renderRecords(records, "emoji", {
      emoji: (rec, i) => `${i}:${String((rec as { name: string; }).name)}`,
    });
    expect(out.split("\n")).toEqual(["0:a", "1:b", "2:c"]);
    expect(renderRecords([], "emoji", { emoji: () => "x" })).toBe("");
  });
});

describe("renderTable", () => {
  test("widths = max cell, single space + pad separation", () => {
    const out = renderTable([
      ["NAME", "SHA"],
      ["wt-a", "abc"],
      ["longer-name", "z"],
    ]);
    const lines = out.split("\n");
    expect(lines[0]).toBe("NAME        SHA");
    expect(lines[1]).toBe("wt-a        abc");
    expect(lines[2]).toBe("longer-name z");
  });

  test("pad option adds extra gap", () => {
    const out = renderTable(
      [
        ["A", "B"],
        ["x", "y"],
      ],
      { pad: 2 },
    );
    expect(out.split("\n")[0]).toBe("A   B");
  });

  test("empty rows -> empty string", () => {
    expect(renderTable([])).toBe("");
  });
});
