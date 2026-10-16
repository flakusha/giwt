// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import { scanFlags } from "./args-scan";

const TABLE = {
  "--flag": { value: "none" },
  "--last": { value: "required" },
  "--tags": { value: "csv" },
} as const;

describe("scanFlags", () => {
  test("empty args yield empty flags and positionals", () => {
    expect(scanFlags([], TABLE)).toEqual({ flags: {}, order: [], positionals: [] });
  });

  test("--none flag sets true", () => {
    const r = scanFlags(["--flag"], TABLE);
    expect(r.flags["--flag"]).toBe(true);
    expect(r.order).toEqual(["--flag"]);
    expect(r.positionals).toEqual([]);
  });

  test("--flag=v splits locally without consuming the next token", () => {
    const r = scanFlags(["--last=5", "pos"], TABLE);
    expect(r.flags["--last"]).toBe("5");
    expect(r.positionals).toEqual(["pos"]);
  });

  test("--flag v consumes the following token as the value", () => {
    const r = scanFlags(["--last", "7"], TABLE);
    expect(r.flags["--last"]).toBe("7");
    expect(r.positionals).toEqual([]);
  });

  test("last occurrence wins for a required flag", () => {
    const r = scanFlags(["--last=1", "--last", "9"], TABLE);
    expect(r.flags["--last"]).toBe("9");
  });

  test("csv values accumulate comma-split across occurrences", () => {
    const r = scanFlags(["--tags=a,b", "--tags=c"], TABLE);
    expect(r.flags["--tags"]).toEqual(["a", "b", "c"]);
  });

  test("-- ends flag parsing; the rest are positionals verbatim", () => {
    const r = scanFlags(["--flag", "--", "--last", "x", "pos"], TABLE);
    expect(r.flags["--flag"]).toBe(true);
    expect(r.flags["--last"]).toBeUndefined();
    expect(r.positionals).toEqual(["--last", "x", "pos"]);
  });

  test("unknown -- tokens throw with the hand-rolled message", () => {
    expect(() => scanFlags(["--nope"], TABLE)).toThrow("unknown flag '--nope'");
  });

  test("bare words are positionals wherever they appear", () => {
    const r = scanFlags(["one", "--flag", "two"], TABLE);
    expect(r.positionals).toEqual(["one", "two"]);
  });

  test("order records first-seen order of distinct flags", () => {
    const r = scanFlags(["--tags=a", "--flag", "--tags=b", "--last=2"], TABLE);
    expect(r.order).toEqual(["--tags", "--flag", "--last"]);
  });
});
