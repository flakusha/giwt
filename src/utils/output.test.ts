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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  colorize,
  log,
  outcomeLine,
  raw,
  resolveFormat,
  resolveLogLevel,
  resolveMinLevel,
  resolveOutputFormat,
  section,
  setColorMode,
  setOutputFormat,
  setRunContext,
  warnOnce,
} from "./output";
import { scratchRoot } from "./scratch-tmp";

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
    // Content assertions (not exact bytes): parallel test files share the
    // process streams, so unrelated stdout (e.g. run-record announces) can
    // land inside the capture window.
    expect(out).toContain("plain\n");
    expect(out).toContain("done\n");
    expect(err).toContain("warn: careful\n");
    expect(err).toContain("error: bad\n");
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
    // The warn rides the logger now (warnOnce → log("warn")), so the
    // message renders in the active format; the quoted value is escaped
    // under json — assert the unescaped prefix only.
    expect(err).toContain("ignoring invalid output format");
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

describe("setColorMode", () => {
  test("invalid value warns and keeps the previous mode", () => {
    const { err } = capture(() => setColorMode("bogus"));
    // warnOnce routes through log("warn") — format-rendered text.
    expect(err).toContain("ignoring invalid color mode");
    // Previous mode (auto, non-TTY here) still applies — plain text.
    expect(colorize("x", "red")).toBe("x");
  });

  test("valid value changes the mode", () => {
    // Neutralize ambient sentinels so colorMode alone decides.
    const savedNoColor = process.env.NO_COLOR;
    const savedGiwtColor = process.env.GIWT_COLOR;
    delete process.env.NO_COLOR;
    delete process.env.GIWT_COLOR;
    try {
      capture(() => setColorMode("always"));
      expect(colorize("x", "red")).toBe("\x1b[31mx\x1b[0m");
      capture(() => setColorMode("never"));
      expect(colorize("x", "red")).toBe("x");
    } finally {
      capture(() => setColorMode("auto"));
      if (savedNoColor === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = savedNoColor;
      if (savedGiwtColor === undefined) delete process.env.GIWT_COLOR;
      else process.env.GIWT_COLOR = savedGiwtColor;
    }
  });
});

describe("env-driven module resolution", () => {
  // resolveMinLevel and resolveFormat run once at module load; a subprocess
  // is the only way to exercise their invalid-env warn paths without
  // re-importing the module (a second in-process instance would split
  // coverage). Subprocess code is not counted by the in-process profiler.
  test("invalid GIWT_LOG and GIWT_OUTPUT warn once at load", () => {
    const script = join(
      mkdtempSync(join(scratchRoot(), "giwt-output-env-")),
      "load-output.ts",
    );
    writeFileSync(
      script,
      `import ${JSON.stringify(resolve(import.meta.dir, "../utils/output"))};\n`,
    );
    try {
      const result = Bun.spawnSync(["bun", script], {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          GIWT_LOG: "bogus",
          GIWT_OUTPUT: "bogus",
        } as Record<string, string>,
      });
      const errText = result.stderr.toString();
      expect(result.exitCode).toBe(0);
      expect(errText).toContain("ignoring invalid GIWT_LOG value \"bogus\"");
      expect(errText).toContain("ignoring invalid GIWT_OUTPUT value \"bogus\"");
    } finally {
      rmSync(dirname(script), { recursive: true, force: true });
    }
  });
});

describe("env resolvers (exported for load-branch coverage)", () => {
  /** Bun.env is process.env — save/restore hermetically per test. */
  function withEnv(vars: Record<string, string | undefined>, fn: () => void): { err: string; } {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
      saved[k] = Bun.env[k];
      if (v === undefined) delete Bun.env[k];
      else Bun.env[k] = v;
    }
    const errSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    let err = "";
    try {
      fn();
    } finally {
      // Read calls BEFORE mockRestore — restore clears the recorded calls.
      err = errSpy.mock.calls.map((a) => String(a[0])).join("");
      errSpy.mockRestore();
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete Bun.env[k];
        else Bun.env[k] = v;
      }
    }
    return { err };
  }

  test("resolveLogLevel: empty/valid/invalid", () => {
    expect(resolveLogLevel(undefined)).toBe("info");
    expect(resolveLogLevel("")).toBe("info");
    expect(resolveLogLevel("  WARN ")).toBe("warn");
    expect(resolveLogLevel("bogus")).toBe(null);
  });

  test("resolveOutputFormat: empty/valid/invalid", () => {
    expect(resolveOutputFormat(undefined)).toBe("simple");
    expect(resolveOutputFormat("")).toBe("simple");
    expect(resolveOutputFormat(" JSONL ")).toBe("jsonl");
    expect(resolveOutputFormat("bogus")).toBe(null);
  });

  test("resolveMinLevel: invalid env warns and falls back to info", () => {
    const { err } = withEnv({ GIWT_LOG: "bogus" }, () => {
      expect(resolveMinLevel()).toBe(1);
    });
    expect(err).toContain("ignoring invalid GIWT_LOG value \"bogus\"");
  });

  test("resolveMinLevel: valid debug env resolves debug", () => {
    const { err } = withEnv({ GIWT_LOG: "debug" }, () => {
      expect(resolveMinLevel()).toBe(0);
    });
    expect(err).toBe("");
  });

  test("resolveFormat: invalid env warns and falls back to simple", () => {
    const { err } = withEnv({ GIWT_OUTPUT: "bogus" }, () => {
      expect(resolveFormat()).toBe("simple");
    });
    expect(err).toContain("ignoring invalid GIWT_OUTPUT value \"bogus\"");
  });

  test("resolveFormat: valid toml env resolves toml", () => {
    const { err } = withEnv({ GIWT_OUTPUT: "toml" }, () => {
      expect(resolveFormat()).toBe("toml");
    });
    expect(err).toBe("");
  });
});

describe("run correlation, fields, warnOnce, outcomeLine", () => {
  test("json/jsonl events carry the active run id; absent without one", () => {
    for (const format of ["json", "jsonl"] as const) {
      setOutputFormat(format);
      setRunContext(null);
      const { err: bare } = capture(() => log("info", "no run"));
      const bareRow = JSON.parse(bare.trim()) as Record<string, unknown>;
      expect("run" in bareRow).toBe(false);
      setRunContext({ id: "20260101T000000Z-1-probe", cmd: "probe" });
      const { err: correlated } = capture(() => log("info", "with run"));
      const row = JSON.parse(correlated.trim()) as { run?: string; };
      expect(row.run).toBe("20260101T000000Z-1-probe");
    }
    setRunContext(null);
    setOutputFormat("simple");
  });

  test("toml events carry run = <id> only while a run is active", () => {
    setOutputFormat("toml");
    setRunContext(null);
    const { err: bare } = capture(() => log("info", "no run"));
    expect(bare).not.toContain("run =");
    setRunContext({ id: "20260101T000001Z-2-probe", cmd: "probe" });
    const { err: withRun } = capture(() => log("info", "with run"));
    expect(withRun).toContain("run = \"20260101T000001Z-2-probe\"");
    setRunContext(null);
    setOutputFormat("simple");
  });

  test("simple/pretty never print fields; machine formats serialize them", () => {
    setOutputFormat("simple");
    const { out: simple } = capture(() => log("info", "plain", { key: 1 }));
    expect(simple).toBe("plain\n");
    setOutputFormat("pretty");
    const { out: pretty } = capture(() => log("info", "plain", { key: 1 }));
    expect(pretty).not.toContain("key");
    setOutputFormat("json");
    const { err: jsonErr } = capture(() => log("info", "typed", { key: 1, tag: "a" }));
    const row = JSON.parse(jsonErr.trim()) as { key?: number; tag?: string; };
    expect(row.key).toBe(1);
    expect(row.tag).toBe("a");
    setOutputFormat("toml");
    const { err: tomlErr } = capture(() => log("info", "typed", { key: 2 }));
    expect(tomlErr).toContain("key = 2");
    setOutputFormat("simple");
  });

  test("warnOnce warns exactly once per key", () => {
    setOutputFormat("simple");
    const first = capture(() => warnOnce("t-key", "once only"));
    expect(first.err).toContain("warn: once only");
    const second = capture(() => warnOnce("t-key", "once only"));
    expect(second.err).toBe("");
    const other = capture(() => warnOnce("t-other", "different key"));
    expect(other.err).toContain("warn: different key");
  });

  test("outcomeLine renders ok|fail <cmd> <summary> · run <id-prefix>", () => {
    setOutputFormat("simple");
    setRunContext({ id: "20260101T000002Z-3-commit-wt", cmd: "commit-wt" });
    const ok = capture(() => outcomeLine(true, "abc123456 subject line"));
    expect(ok.out).toBe("ok commit-wt abc123456 subject line · run 20260101T000002Z-3-commit-wt\n");
    const fail = capture(() => outcomeLine(false, "no staged changes"));
    expect(fail.out).toBe("fail commit-wt no staged changes · run 20260101T000002Z-3-commit-wt\n");
    // Explicit runId wins; machine formats route the line to stderr.
    setOutputFormat("json");
    const machine = capture(() => outcomeLine(true, "done", "20260101T000003Z-4-sync"));
    expect(machine.out).toBe("");
    expect(machine.err).toBe("ok commit-wt done · run 20260101T000003Z-4-sync\n");
    setRunContext(null);
    const noRun = capture(() => outcomeLine(true, "idempotent"));
    expect(noRun.err).toBe("ok ? idempotent\n");
    setOutputFormat("simple");
  });
});
