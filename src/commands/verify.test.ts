// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for `giwt verify` (src/commands/verify.ts) and its engine
 * (src/commands/verify-scripts.ts).
 *
 * Resource contract (parallel-safe): every test owns a private
 * mkdtempSync(join(scratchRoot(), "giwt-verify-<slug>-")) fixture removed
 * in afterEach. Output is captured via process.stdout/stderr write spies;
 * process.exit is a spy throwing an __exit sentinel; process.exitCode is
 * saved/restored so a failing run cannot poison sibling tests. Child
 * scripts are plain `sh` executables (no git involved), so no
 * isolatedGitEnv is needed.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { SpawnResult } from "../doctor/check/spawn";
import type { WorktreeConfig } from "../utils/config";
import { setOutputFormat, setRunContext } from "../utils/output";
import { scratchRoot } from "../utils/scratch-tmp";
import { DEFAULT_SETTINGS, type GiwtSettings } from "../utils/settings";
import { verify } from "./verify";
import { discoverScripts, runVerifyScripts, selectScripts } from "./verify-scripts";

let root = "";
let prevExitCode: number | undefined;

beforeEach(() => {
  setOutputFormat("simple");
  // Pin the run context so outcomeLine asserts the full contract
  // (`fail verify … · run <id>`) instead of the `?` fallback.
  setRunContext({ id: "test-run-0", cmd: "verify" });
  prevExitCode = typeof process.exitCode === "number" ? process.exitCode : undefined;
});

afterEach(() => {
  setRunContext(null);
  // Bun quirk (measured): assigning undefined does NOT clear
  // process.exitCode, so restore an explicit number — 0 when the ambient
  // value was unset — or a failing run leaks exit 1 into `bun test`.
  process.exitCode = prevExitCode ?? 0;
  if (root !== "") {
    rmSync(root, { recursive: true, force: true });
    root = "";
  }
});

function makeRoot(slug: string): string {
  root = mkdtempSync(join(scratchRoot(), `giwt-verify-${slug}-`));
  return root;
}

/** Executable `#!/bin/sh` script at root/rel. */
function writeScript(base: string, rel: string, body: string, mode = 0o755): string {
  const p = join(base, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, mode);
  return p;
}

function cfgFor(
  base: string,
  overrides: Partial<GiwtSettings["verify"]> = {},
): WorktreeConfig {
  return {
    repoRoot: base,
    worktreeRoot: base,
    treeDir: base,
    settings: {
      ...DEFAULT_SETTINGS,
      verify: { ...DEFAULT_SETTINGS.verify, ...overrides },
    },
  };
}

interface Capture {
  out: () => string;
  err: () => string;
  restore: () => void;
}

function capture(): Capture {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const push = (chunks: string[]) => (chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  };
  const out = spyOn(process.stdout, "write").mockImplementation(push(outChunks) as never);
  const err = spyOn(process.stderr, "write").mockImplementation(push(errChunks) as never);
  return {
    out: () => outChunks.join(""),
    err: () => errChunks.join(""),
    restore: () => {
      out.mockRestore();
      err.mockRestore();
    },
  };
}

/** process.exit spy throwing the __exit sentinel (handler tests restore it). */
function exitSentinel(): { codes: number[]; restore: () => void; } {
  const codes: number[] = [];
  const original = process.exit;
  process.exit = ((code?: number) => {
    codes.push(code ?? 0);
    throw new Error(`__exit:${code}`);
  }) as never;
  return {
    codes,
    restore: () => {
      process.exit = original;
    },
  };
}

// ── Discovery ────────────────────────────────────────────────────────────

describe("discoverScripts", () => {
  test("sorted deterministically; non-executable, hidden, and non-matching skipped", () => {
    const base = makeRoot("discovery");
    writeScript(base, ".tmp/verify-b.sh", "true");
    writeScript(base, ".tmp/verify-a.sh", "true");
    writeScript(base, ".tmp/verify-noexec.sh", "true", 0o644);
    writeScript(base, ".tmp/.verify-hidden.sh", "true");
    writeScript(base, "scripts/verify-c.sh", "true");
    writeScript(base, "scripts/other.sh", "true");

    const found = discoverScripts(base, [".tmp/verify*", "scripts/verify*"]);

    expect(found).toEqual([".tmp/verify-a.sh", ".tmp/verify-b.sh", "scripts/verify-c.sh"]);
  });

  test("directory patterns recurse; duplicates dedupe; ? matches one char", () => {
    const base = makeRoot("dir-pattern");
    writeScript(base, "probes/nested/deep.sh", "true");
    writeScript(base, "probes/nested/.hidden.sh", "true");
    writeScript(base, "scripts/verify-a.sh", "true");
    writeScript(base, "scripts/verify-ab.sh", "true");

    // Plain directory pattern collects executables recursively (hidden skipped).
    expect(discoverScripts(base, ["probes"])).toEqual(["probes/nested/deep.sh"]);
    // Two patterns hitting the same file keep one entry.
    expect(discoverScripts(base, ["scripts/verify-a.sh", "scripts/*"])).toEqual([
      "scripts/verify-a.sh",
      "scripts/verify-ab.sh",
    ]);
    // ? is a single-character wildcard.
    expect(discoverScripts(base, ["scripts/verify-?.sh"])).toEqual(["scripts/verify-a.sh"]);
  });

  test("escaping patterns are refused with a warn", () => {
    const base = makeRoot("escape");
    writeScript(base, "outside/x.sh", "true");
    const cap = capture();
    try {
      expect(discoverScripts(base, ["../outside/*"])).toEqual([]);
      expect(cap.err()).toContain("must stay inside the repo");
    } finally {
      cap.restore();
    }
  });

  test("unreadable pattern intermediates (file in path, missing dir) yield nothing", () => {
    const base = makeRoot("enotdir");
    writeScript(base, "settings.ts", "true");
    // readdirSync on a regular file throws ENOTDIR: the walk skips it.
    expect(discoverScripts(base, ["settings.ts/verify*"])).toEqual([]);
    expect(discoverScripts(base, ["no-such-dir/verify*"])).toEqual([]);
  });
});

// ── Name filtering ───────────────────────────────────────────────────────

describe("selectScripts", () => {
  const paths = ["a/one.sh", "b/two.sh"];

  test("exact basename and unique prefix both resolve", () => {
    expect(selectScripts(paths, ["one.sh"])).toEqual({ selected: ["a/one.sh"], error: null });
    expect(selectScripts(paths, ["tw"])).toEqual({ selected: ["b/two.sh"], error: null });
  });

  test("ambiguous prefix and unknown name are errors naming the filter", () => {
    const dup = ["a/one.sh", "b/one.sh"];
    expect(selectScripts(dup, ["one"])!.error).toContain("matches 2 scripts");
    const unknown = selectScripts(paths, ["zzz"]);
    expect(unknown.error).toContain("no verify script matches 'zzz'");
    expect(unknown.error).toContain("one.sh, two.sh");
  });

  test("repeated filters dedupe to one run", () => {
    expect(selectScripts(paths, ["one.sh", "on"])).toEqual({
      selected: ["a/one.sh"],
      error: null,
    });
  });
});

// ── Execution engine ─────────────────────────────────────────────────────

describe("runVerifyScripts", () => {
  test("aggregates pass/fail with tail caps via the injected spawn seam", async () => {
    const base = makeRoot("stub-run");
    writeScript(base, "scripts/verify-ok.sh", "true");
    writeScript(base, "scripts/verify-bad.sh", "true");
    const ran: string[] = [];
    const stub = (cmd: string[]): SpawnResult => {
      ran.push(cmd[0] ?? "");
      const name = basename(cmd[0] ?? "");
      return name === "verify-ok.sh"
        ? { exitCode: 0, stdout: "", stderr: "" }
        : { exitCode: 2, stdout: "l1\nl2\nl3\nl4", stderr: "boom" };
    };

    const report = await runVerifyScripts({
      root: base,
      scripts: ["scripts/verify-ok.sh", "scripts/verify-bad.sh"],
      timeoutMs: 5000,
      tailLines: 2,
      spawn: stub,
    });

    // Sequential, discovery order.
    expect(ran).toEqual([
      join(base, "scripts/verify-ok.sh"),
      join(base, "scripts/verify-bad.sh"),
    ]);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.total).toBe(2);
    expect(report.ok).toBe(false);
    expect(report.timeoutMs).toBe(5000);
    const okEntry = report.scripts[0]!;
    expect(okEntry.status).toBe("pass");
    expect("outputTail" in okEntry ? okEntry.outputTail : undefined).toBeUndefined();
    const bad = report.scripts[1]!;
    expect(bad.status).toBe("fail");
    expect(bad.exitCode).toBe(2);
    // stream_tail cap: dropped-line notice + last 2 lines only (combined
    // stdout+stderr is 5 lines: l1..l4 then boom).
    expect(bad.outputTail).toBe("… 3 earlier line(s) dropped\nl4\nboom");
  });

  test("real seam: script runs with cwd = repo root and pass/fail map", async () => {
    const base = makeRoot("real-run");
    // Pass scripts discard their output (tail is a failure contract), so the
    // cwd probe fails on purpose to surface its own cwd echo.
    writeScript(base, "scripts/verify-cwd.sh", "echo \"at $(basename \"$PWD\")\"; exit 1");
    writeScript(base, "scripts/verify-fail.sh", "echo out; echo err >&2; exit 3");
    writeScript(base, "scripts/verify-ok.sh", "true");

    const report = await runVerifyScripts({
      root: base,
      scripts: ["scripts/verify-ok.sh", "scripts/verify-cwd.sh", "scripts/verify-fail.sh"],
      timeoutMs: 10000,
      tailLines: 25,
    });

    expect(report.scripts[0]!.status).toBe("pass");
    expect("outputTail" in report.scripts[0]! ? report.scripts[0]!.outputTail : undefined)
      .toBeUndefined();
    const cwd = report.scripts[1]!;
    expect(cwd.status).toBe("fail");
    expect(cwd.exitCode).toBe(1);
    expect(cwd.outputTail).toBe(`at ${basename(base)}`);
    const fail = report.scripts[2]!;
    expect(fail.status).toBe("fail");
    expect(fail.exitCode).toBe(3);
    expect(fail.outputTail).toContain("out");
    expect(fail.outputTail).toContain("err");
    expect(report.ok).toBe(false);
  });

  test("real seam: unexecutable garbage degrades to a failed entry (ENOEXEC)", async () => {
    const base = makeRoot("enoexec");
    mkdirSync(join(base, "scripts"), { recursive: true });
    const garbage = join(base, "scripts/verify-garbage.sh");
    writeFileSync(garbage, "this is not a script\n");
    chmodSync(garbage, 0o755);
    // Broken shebang interpreter is the ENOENT sibling of the same crash.
    writeScript(base, "scripts/verify-broken-shebang.sh", "true");
    writeFileSync(join(base, "scripts/verify-broken-shebang.sh"), "#!/bin/no-such-interpreter\n");

    const report = await runVerifyScripts({
      root: base,
      scripts: ["scripts/verify-garbage.sh", "scripts/verify-broken-shebang.sh"],
      timeoutMs: 5000,
      tailLines: 25,
    });

    // One unexecutable script must not crash the run: both entries report.
    expect(report.total).toBe(2);
    expect(report.failed).toBe(2);
    expect(report.ok).toBe(false);
    for (const entry of report.scripts) {
      expect(entry.status).toBe("fail");
      expect(entry.exitCode).toBe(126);
      expect(entry.outputTail).toBeTruthy();
    }
  });

  test("real seam: budget kills a wedged script and reports timeout", async () => {
    const base = makeRoot("timeout");
    // sleep 5 (not 30): far above the 300ms budget for determinism, but if a
    // hard kill ever orphaned the child it lingers seconds, not half a minute.
    writeScript(base, "scripts/verify-slow.sh", "sleep 5");

    const report = await runVerifyScripts({
      root: base,
      scripts: ["scripts/verify-slow.sh"],
      timeoutMs: 300,
      tailLines: 25,
    });

    const entry = report.scripts[0]!;
    expect(entry.status).toBe("timeout");
    expect(entry.exitCode).toBe(-1);
    expect(entry.durationMs).toBeLessThan(10_000);
    expect(report.ok).toBe(false);
    expect(report.failed).toBe(1);
  }, 20_000);
});

// ── Command surface ──────────────────────────────────────────────────────

describe("verify command", () => {
  test("human output: per-script lines, one outcome line, exit 1 on failure", async () => {
    const base = makeRoot("cmd-human");
    writeScript(base, ".tmp/verify-pass.sh", "true");
    writeScript(base, ".tmp/verify-fail.sh", "echo out-line; echo err-line >&2; exit 2");
    const cap = capture();
    try {
      await verify([], cfgFor(base));
      const out = cap.out();
      expect(out).toContain("[PASS] verify-pass.sh");
      expect(out).toContain("[FAIL] verify-fail.sh — exit 2");
      expect(out).toContain("out-line");
      expect(out).toContain("err-line");
      expect(out).toContain("patterns: .tmp/verify*, scripts/verify*");
      // EXACTLY ONE final outcome line.
      const outcomes = out.match(/^(ok|fail) verify .*$/gm) ?? [];
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]).toBe("fail verify 1 passed, 1 failed · run test-run-0");
      expect(process.exitCode).toBe(1);
    } finally {
      cap.restore();
    }
  });

  test("all green: ok outcome, exit code left untouched", async () => {
    const base = makeRoot("cmd-green");
    writeScript(base, ".tmp/verify-a.sh", "true");
    writeScript(base, ".tmp/verify-b.sh", "true");
    const cap = capture();
    try {
      // Ambient exitCode may carry garbage from sibling suites; the contract
      // is that a green run does not set it to 1.
      const before = process.exitCode;
      await verify([], cfgFor(base));
      const outcomes = cap.out().match(/^(ok|fail) verify .*$/gm) ?? [];
      expect(outcomes).toEqual(["ok verify 2 passed · run test-run-0"]);
      expect(process.exitCode).toBe(before);
    } finally {
      cap.restore();
    }
  });

  test("--json: clean payload on stdout, outcome line on stderr", async () => {
    const base = makeRoot("cmd-json");
    writeScript(base, ".tmp/verify-pass.sh", "true");
    writeScript(base, ".tmp/verify-fail.sh", "echo boom >&2; exit 1");
    const cap = capture();
    try {
      await verify(["--json"], cfgFor(base));
      const parsed = JSON.parse(cap.out()) as {
        scripts: Array<Record<string, unknown>>;
        passed: number;
        failed: number;
        total: number;
        ok: boolean;
        timeoutMs: number;
      };
      expect(parsed.passed).toBe(1);
      expect(parsed.failed).toBe(1);
      expect(parsed.total).toBe(2);
      expect(parsed.ok).toBe(false);
      expect(parsed.timeoutMs).toBe(DEFAULT_SETTINGS.verify.timeoutMs);
      const failEntry = parsed.scripts.find((s) => s["name"] === "verify-fail.sh")!;
      expect(failEntry["status"]).toBe("fail");
      expect(failEntry["exitCode"]).toBe(1);
      expect(failEntry["path"]).toBe(".tmp/verify-fail.sh");
      expect(typeof failEntry["durationMs"]).toBe("number");
      // stdout carries ONLY the payload; stderr carries exactly one outcome line.
      expect(cap.out()).not.toMatch(/^(ok|fail) verify /m);
      expect(cap.err().split("\n").filter((l) => /^(ok|fail) verify /.test(l))).toHaveLength(1);
      expect(cap.err()).toContain("fail verify 1 passed, 1 failed · run test-run-0");
      expect(process.exitCode).toBe(1);
    } finally {
      cap.restore();
    }
  });

  test("name filter: exact and unique-prefix select, none matches the rest", async () => {
    const base = makeRoot("cmd-filter");
    writeScript(base, ".tmp/verify-keep.sh", "true");
    writeScript(base, ".tmp/verify-other.sh", "true");
    const cap = capture();
    try {
      await verify(["verify-keep.sh"], cfgFor(base));
      expect(cap.out()).toContain("[PASS] verify-keep.sh");
      expect(cap.out()).not.toContain("verify-other.sh");
      expect(cap.out()).toContain("ok verify 1 passed");
    } finally {
      cap.restore();
    }
    const cap2 = capture();
    try {
      await verify(["verify-k"], cfgFor(base));
      expect(cap2.out()).toContain("ok verify 1 passed");
    } finally {
      cap2.restore();
    }
  });

  test("ambiguous filter is a usage error (exit 1)", async () => {
    const base = makeRoot("cmd-ambiguous");
    writeScript(base, ".tmp/verify-a1.sh", "true");
    writeScript(base, ".tmp/verify-a2.sh", "true");
    const cap = capture();
    const sent = exitSentinel();
    try {
      expect(() => verify(["verify-a"], cfgFor(base))).toThrow(/__exit:1/);
      expect(sent.codes).toEqual([1]);
      expect(cap.err()).toContain("matches 2 scripts");
    } finally {
      cap.restore();
      sent.restore();
    }
  });

  test("configured patterns replace the convention default", async () => {
    const base = makeRoot("cmd-patterns");
    writeScript(base, ".tmp/verify-ignored.sh", "true");
    writeScript(base, "probes/p.sh", "true");
    const cap = capture();
    try {
      await verify([], cfgFor(base, { scripts: ["probes/*"] }));
      expect(cap.out()).toContain("[PASS] p.sh");
      expect(cap.out()).toContain("patterns: probes/*");
      expect(cap.out()).not.toContain("verify-ignored.sh");
    } finally {
      cap.restore();
    }
  });

  test("empty discovery reports 0 passed and exits green", async () => {
    const base = makeRoot("cmd-empty");
    const cap = capture();
    try {
      const before = process.exitCode;
      await verify([], cfgFor(base));
      expect(cap.out()).toContain("no verify scripts found");
      expect(cap.out()).toContain("ok verify 0 passed");
      expect(process.exitCode).toBe(before);
    } finally {
      cap.restore();
    }
  });

  test("--json with no scripts still emits a parseable empty payload on stdout", async () => {
    const base = makeRoot("cmd-empty-json");
    const cap = capture();
    try {
      await verify(["--json"], cfgFor(base));
      // Machine consumers JSON.parse stdout unconditionally: an empty
      // discovery must still produce the payload, never an empty buffer.
      const parsed = JSON.parse(cap.out()) as {
        scripts: unknown[];
        passed: number;
        failed: number;
        total: number;
        ok: boolean;
        timeoutMs: number;
      };
      expect(parsed.scripts).toEqual([]);
      expect(parsed.total).toBe(0);
      expect(parsed.ok).toBe(true);
      expect(parsed.timeoutMs).toBe(DEFAULT_SETTINGS.verify.timeoutMs);
      // Exactly one outcome line, and it is the ok variant on the empty path.
      const outcomes = cap.err().match(/^(ok|fail) verify .*$/gm) ?? [];
      expect(outcomes).toEqual(["ok verify 0 passed · run test-run-0"]);
    } finally {
      cap.restore();
    }
  });

  test("--timeout override runs and names the budget in the TIMEOUT line", async () => {
    const base = makeRoot("cmd-timeout");
    // sleep 5: bounded orphan risk under load, still ≫ the 400ms budget.
    writeScript(base, ".tmp/verify-slow.sh", "sleep 5");
    const cap = capture();
    try {
      await verify(["--timeout=400"], cfgFor(base));
      expect(cap.out()).toContain("[TIMEOUT] verify-slow.sh — killed at 400ms budget");
      expect(cap.out()).toContain("fail verify 0 passed, 1 failed");
      expect(process.exitCode).toBe(1);
    } finally {
      cap.restore();
    }
  }, 20_000);

  test("bad --timeout and unknown flags are usage errors (exit 1)", async () => {
    const base = makeRoot("cmd-usage");
    const cap = capture();
    const sent = exitSentinel();
    try {
      expect(() => verify(["--timeout", "0"], cfgFor(base))).toThrow(/__exit:1/);
      expect(cap.err()).toContain("--timeout must be an integer >= 1");
      expect(() => verify(["--wat"], cfgFor(base))).toThrow(/__exit:1/);
      expect(cap.err()).toContain("unknown flag '--wat'");
    } finally {
      cap.restore();
      sent.restore();
    }
  });

  test("--help prints usage and runs nothing", async () => {
    const base = makeRoot("cmd-help");
    const cap = capture();
    try {
      const before = process.exitCode;
      await verify(["--help"], cfgFor(base));
      expect(cap.out()).toContain("Usage: giwt verify [--json] [--timeout <ms>]");
      expect(cap.out()).toContain(".tmp/verify*");
      expect(process.exitCode).toBe(before);
    } finally {
      cap.restore();
    }
  });
});
