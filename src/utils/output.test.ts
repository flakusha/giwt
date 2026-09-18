// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for src/utils/output.ts log formats.
 *
 * Resource contract (parallel-safe): no files, no env mutation, no shared
 * state beyond the module-level format — every test sets its format via
 * setOutputFormat() first, so no test depends on ambient state or order.
 * Output captured by spying process.stdout/stderr.write (logger uses
 * emit(), never console.*).
 */

import { describe, expect, spyOn, test } from "bun:test";
import { colorize, log, raw, section, setOutputFormat } from "./output";

function capture(fn: () => void): { out: string; err: string; } {
  const outSpy = spyOn(process.stdout, "write");
  const errSpy = spyOn(process.stderr, "write");
  outSpy.mockImplementation(() => true);
  errSpy.mockImplementation(() => true);
  let out = "";
  let err = "";
  try {
    fn();
  } finally {
    out = outSpy.mock.calls.map((args) => String(args[0])).join("");
    err = errSpy.mock.calls.map((args) => String(args[0])).join("");
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
  return { out, err };
}

describe("simple format (default)", () => {
  test("info/success emit bare messages; warn/error carry level tags", () => {
    setOutputFormat("simple");
    const { out, err } = capture(() => {
      log("info", "plain");
      log("success", "done");
      log("warn", "careful");
      log("error", "bad");
    });
    expect(out).toBe("plain\ndone\n");
    expect(err).toBe("warn: careful\nerror: bad\n");
  });

  test("output is ASCII-only, no ANSI escapes", () => {
    setOutputFormat("simple");
    const { out } = capture(() => log("success", "x"));
    expect(out).not.toContain("\x1b[");
    expect([...out].every((ch) => ch.charCodeAt(0) <= 0x7f)).toBe(true);
  });

  test("section renders as an ASCII rule", () => {
    setOutputFormat("simple");
    const { out } = capture(() => section("Build"));
    expect(out).toBe("\n-- Build\n");
  });
});

describe("pretty format", () => {
  test("keeps level glyphs", () => {
    setOutputFormat("pretty");
    const { out } = capture(() => {
      log("success", "ok");
      section("Build");
    });
    expect(out).toContain("\u2713");
    expect(out).toContain("\u2551\u2551\u2551 Build \u2551\u2551\u2551");
  });
});

describe("json/jsonl formats", () => {
  test("one parseable JSON object per event", () => {
    for (const format of ["json", "jsonl"] as const) {
      setOutputFormat(format);
      const { out, err } = capture(() => {
        log("info", "first");
        log("warn", "second");
      });
      // Machine formats route ALL log events to stderr; stdout carries
      // only raw() payload (FIX-json-output-polluted-by-run-record-announcement).
      expect(out).toBe("");
      const rows = err.trim().split("\n");
      const first = JSON.parse(rows[0]!) as { ts: string; level: string; msg: string; };
      expect(first.level).toBe("info");
      expect(first.msg).toBe("first");
      expect(first.ts).toBeTruthy();
      const warnRow = JSON.parse(rows[1]!) as { level: string; msg: string; };
      expect(warnRow.level).toBe("warn");
      expect(warnRow.msg).toBe("second");
    }
  });

  test("section becomes an info event", () => {
    setOutputFormat("json");
    const { out, err } = capture(() => section("Stage"));
    expect(out).toBe("");
    const row = JSON.parse(err.trim()) as { level: string; msg: string; };
    expect(row.level).toBe("info");
    expect(row.msg).toBe("Stage");
  });
});

describe("toml format", () => {
  test("emits valid [[log]] array-of-tables blocks", () => {
    setOutputFormat("toml");
    const { out, err } = capture(() => {
      log("info", "has \"quotes\" and \\ backslash");
      log("info", "second");
    });
    expect(out).toBe("");
    const doc = Bun.TOML.parse(err) as { log: Array<{ level: string; msg: string; ts: string; }>; };
    expect(doc.log.length).toBe(2);
    expect(doc.log[0]!.msg).toBe("has \"quotes\" and \\ backslash");
    expect(doc.log[1]!.level).toBe("info");
  });
});

describe("format resolution", () => {
  test("invalid value warns once and keeps the previous format", () => {
    setOutputFormat("json");
    const { err } = capture(() => setOutputFormat("bogus"));
    expect(err).toContain("ignoring invalid output format \"bogus\"");
    const { err: stillJson } = capture(() => log("info", "still json"));
    expect(() => JSON.parse(stillJson.trim())).not.toThrow();
    setOutputFormat("simple");
  });

  test("value matching is normalized (trim + case)", () => {
    setOutputFormat("  JSON ");
    const { err } = capture(() => log("info", "x"));
    expect(() => JSON.parse(err.trim())).not.toThrow();
    setOutputFormat("simple");
  });
});

describe("raw data channel", () => {
  test("stays byte-stable in every format", () => {
    for (const format of ["simple", "pretty", "json", "toml"] as const) {
      setOutputFormat(format);
      const { out } = capture(() => raw("data-row"));
      expect(out).toBe("data-row\n");
    }
  });
});

describe("colorize", () => {
  test("respects NO_COLOR", () => {
    const prev = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
    try {
      expect(colorize("x", "red")).toBe("x");
    } finally {
      if (prev === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = prev;
    }
  });
});
