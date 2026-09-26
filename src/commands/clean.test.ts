// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for `giwt clean` and the shared scratchpad scanner.
 *
 * Resource contract (parallel-safe): EVERY test owns a private
 * `mkdtempSync(join(tmpdir(), "giwt-clean-<slug>-"))` root — no fixed or
 * shared paths anywhere — and removes it with `rmSync(root, { recursive:
 * true, force: true })` in a `finally`. File ages are simulated with
 * `utimesSync` against a fixed NOW (never sleeps), and scanScratch gets
 * that NOW injected, so results are deterministic and order-independent.
 * process.exitCode and process.exit spies are saved/restored per test.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { scanScratch } from "../utils/scratch";
import type { ScratchClass, ScratchConfig, ScratchScan } from "../utils/scratch";
import { DEFAULT_SETTINGS, type GiwtSettings } from "../utils/settings";
import { clean } from "./clean";

const DAY = 24 * 60 * 60 * 1000;
/** Ages hang off a clock captured once at module load: close enough to the
 *  real Date.now() that handler tests (default nowMs) agree with the
 *  injected-NOW scan tests, and no future timestamps land on disk. */
const NOW = Date.now();
const CFG: ScratchConfig = {
  tmpMaxAgeDays: 7,
  lcovKeepLatest: 2,
  jscpdMaxAgeDays: 7,
  checkReportKeep: 20,
};

let root = "";

afterEach(() => {
  if (root !== "") {
    rmSync(root, { recursive: true, force: true });
    root = "";
  }
});

function makeRoot(slug: string): string {
  root = mkdtempSync(join(tmpdir(), `giwt-clean-${slug}-`));
  return root;
}

function scratchDir(base: string): string {
  return join(base, DEFAULT_SETTINGS.scratch.root);
}

function cfgFor(
  base: string,
  overrides: Partial<GiwtSettings["scratch"]> = {},
): WorktreeConfig {
  return {
    repoRoot: base,
    worktreeRoot: base,
    treeDir: base,
    settings: {
      ...DEFAULT_SETTINGS,
      scratch: { ...DEFAULT_SETTINGS.scratch, ...overrides },
    },
  };
}

function makeFile(base: string, rel: string, size: number, ageDays: number): string {
  const p = join(base, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, Buffer.alloc(size, 0x61));
  utimesSync(p, new Date(NOW - ageDays * DAY), new Date(NOW - ageDays * DAY));
  return p;
}

function makeDir(base: string, rel: string, ageDays: number): string {
  const p = join(base, rel);
  mkdirSync(p, { recursive: true });
  utimesSync(p, new Date(NOW - ageDays * DAY), new Date(NOW - ageDays * DAY));
  return p;
}

/** The classification fixture shared by tests 1 and 4: fresh/old tmp
 *  files, three cov-* dirs (newest kept, oldest pruned), an lcov spill
 *  inside a KEPT cov dir plus one on a plain path, an aged jscpd report,
 *  22 check reports (cap 20), and a symlink that must be ignored. */
function seedScratch(base: string): void {
  const tmp = scratchDir(base);
  makeDir(base, DEFAULT_SETTINGS.scratch.root, 0);
  makeFile(tmp, "fresh.tmp", 10, 1);
  makeFile(tmp, "old.tmp", 10, 10);
  makeDir(tmp, "cov-a", 1);
  makeFile(tmp, join("cov-a", "lcov.info"), 100, 1);
  makeDir(tmp, "cov-b", 2);
  makeFile(tmp, join("cov-b", "lcov.info"), 200, 2);
  makeDir(tmp, "cov-c", 3);
  makeFile(tmp, join("cov-c", "lcov.info"), 300, 3);
  makeFile(tmp, join("cov-a", ".lcov.info.deadbeef.tmp"), 40, 1);
  makeFile(tmp, join("inner", "lcov.extra.tmp"), 30, 1);
  makeFile(tmp, "jscpd-report.json", 500, 10);
  makeFile(tmp, join("jscpd", "jscpd-report.json"), 700, 10); // nested, aged
  makeFile(tmp, join("jscpd-archive", "jscpd-report.json"), 800, 0); // jscpd* dir, fresh
  makeFile(tmp, join("jscpd", "deep", "jscpd-report.json"), 900, 10); // too deep: ignored
  for (let age = 1; age <= 22; age++) {
    makeFile(tmp, `check-report-${age}.json`, 1000 + age, age);
  }
  symlinkSync("fresh.tmp", join(tmp, "link.tmp"));
  // Directory mtimes LAST: writing children bumps a dir's mtime, which
  // would otherwise scramble the cov-* keep-latest ordering.
  utimesSync(join(tmp, "cov-a"), new Date(NOW - DAY), new Date(NOW - DAY));
  utimesSync(join(tmp, "cov-b"), new Date(NOW - 2 * DAY), new Date(NOW - 2 * DAY));
  utimesSync(join(tmp, "cov-c"), new Date(NOW - 3 * DAY), new Date(NOW - 3 * DAY));
  utimesSync(tmp, new Date(), new Date());
}

function pathsOf(
  scan: ScratchScan,
  name: ScratchClass["name"],
  field: "candidates" | "keep",
): string[] {
  return (scan.classes.find((c) => c.name === name)?.[field] ?? []).map((e) => e.path);
}

function classByName(scan: ScratchScan, name: ScratchClass["name"]): ScratchClass {
  const cls = scan.classes.find((c) => c.name === name);
  if (!cls) throw new Error(`missing class ${name}`);
  return cls;
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

describe("scanScratch", () => {
  test("classifies tmp/lcov/jscpd/check-report with keep-latest and caps", () => {
    const base = makeRoot("classify");
    seedScratch(base);
    const tmp = scratchDir(base);

    const scan = scanScratch(tmp, CFG, NOW);

    expect(scan.classes.map((c) => c.name)).toEqual(["tmp", "lcov", "jscpd", "check-report"]);

    // tmp: fresh kept, old candidate, symlink ignored, cov-* excluded.
    expect(pathsOf(scan, "tmp", "candidates")).toEqual([join(tmp, "old.tmp")]);
    expect(pathsOf(scan, "tmp", "keep")).toEqual([join(tmp, "fresh.tmp")]);
    const allListed = [...pathsOf(scan, "tmp", "candidates"), ...pathsOf(scan, "tmp", "keep")];
    expect(allListed).not.toContain(join(tmp, "link.tmp"));

    // lcov: spills always candidates (even inside a KEPT cov dir),
    // cov-* keep-latest-2 across 3 dirs by mtime — cov-c (oldest) pruned.
    const lcovCandidates = pathsOf(scan, "lcov", "candidates");
    expect(lcovCandidates).toContain(join(tmp, "cov-a", ".lcov.info.deadbeef.tmp"));
    expect(lcovCandidates).toContain(join(tmp, "inner", "lcov.extra.tmp"));
    expect(lcovCandidates).toContain(join(tmp, "cov-c"));
    expect(lcovCandidates).toHaveLength(3);
    expect(pathsOf(scan, "lcov", "keep").map((p) => p.split("/").pop())).toEqual([
      "cov-a",
      "cov-b",
    ]);
    const covC = classByName(scan, "lcov").candidates.find((e) => e.path === join(tmp, "cov-c"));
    expect(covC?.bytes).toBe(300); // recursive dir bytes, dir's own mtime
    expect(covC?.mtimeMs).toBe(NOW - 3 * DAY);

    // jscpd: aged root AND nested jscpd*/ reports are candidates (newest
    // first, path tiebreak); a fresh prefix-dir report is kept, and
    // two-levels-deep nesting does not match at all.
    expect(pathsOf(scan, "jscpd", "candidates")).toEqual([
      join(tmp, "jscpd-report.json"),
      join(tmp, "jscpd", "jscpd-report.json"),
    ]);
    expect(pathsOf(scan, "jscpd", "keep")).toEqual([
      join(tmp, "jscpd-archive", "jscpd-report.json"),
    ]);
    const allJscpd = [
      ...pathsOf(scan, "jscpd", "candidates"),
      ...pathsOf(scan, "jscpd", "keep"),
    ];
    expect(allJscpd).not.toContain(join(tmp, "jscpd", "deep", "jscpd-report.json"));
    const youngGate = scanScratch(tmp, { ...CFG, jscpdMaxAgeDays: 30 }, NOW);
    expect(pathsOf(youngGate, "jscpd", "candidates")).toEqual([]);
    expect(pathsOf(youngGate, "jscpd", "keep")).toEqual([
      join(tmp, "jscpd-archive", "jscpd-report.json"),
      join(tmp, "jscpd-report.json"),
      join(tmp, "jscpd", "jscpd-report.json"),
    ]);

    // check-report: 22 files, cap 20 → the two oldest are candidates.
    const reportCandidates = pathsOf(scan, "check-report", "candidates");
    expect(reportCandidates).toEqual([
      join(tmp, "check-report-21.json"),
      join(tmp, "check-report-22.json"),
    ]);
    expect(pathsOf(scan, "check-report", "keep")).toHaveLength(20);

    // Totals: classes are disjoint, so counts/bytes never double-count.
    // files: 10+10+100+200+300+40+30+500+700+800+900 + sum(1001..1022)
    //   = 3590 + 22253 = 25843
    expect(scan.totalCandidateCount).toBe(8);
    expect(scan.totalCandidateBytes).toBe(10 + 370 + 1200 + 2043);
    expect(scan.totalBytes).toBe(25843);
    expect(scan.oldestMtimeMs).toBe(NOW - 22 * DAY);
  });

  test("missing root yields a zero scan without throwing", () => {
    const base = makeRoot("missing");
    const scan = scanScratch(join(base, "absent"), CFG, NOW);
    expect(scan.classes).toHaveLength(4);
    for (const cls of scan.classes) {
      expect(cls.candidates).toEqual([]);
      expect(cls.keep).toEqual([]);
    }
    expect(scan.totalCandidateBytes).toBe(0);
    expect(scan.totalCandidateCount).toBe(0);
    expect(scan.totalBytes).toBe(0);
    expect(scan.oldestMtimeMs).toBeNull();
  });
});

describe("clean handler", () => {
  test("dry-run (explicit, default, and --verbose) prints the plan and deletes nothing", async () => {
    const base = makeRoot("dryrun");
    seedScratch(base);
    const tmp = scratchDir(base);

    const cap = capture();
    try {
      await clean(["--dry-run"], cfgFor(base));
      const text = cap.out();
      expect(text).toContain("   tmp: 1 file(s), 10 B");
      expect(text).toContain("   lcov: 3 file(s), 370 B");
      expect(text).toContain("   total: 8 file(s), 3.5 KB");
    } finally {
      cap.restore();
    }
    expect(existsSync(join(tmp, "old.tmp"))).toBe(true);
    expect(existsSync(join(tmp, "cov-c"))).toBe(true);

    // No flags at all behaves as dry-run too.
    const cap2 = capture();
    try {
      await clean([], cfgFor(base));
      expect(cap2.out()).toContain("   total: 8 file(s)");
    } finally {
      cap2.restore();
    }
    expect(existsSync(join(tmp, "jscpd-report.json"))).toBe(true);

    // --verbose lists every candidate path, indented.
    const cap3 = capture();
    try {
      await clean(["--verbose"], cfgFor(base));
      const text = cap3.out();
      expect(text).toContain(`     ${join(tmp, "old.tmp")}`);
      expect(text).toContain(`     ${join(tmp, "cov-c")}`);
    } finally {
      cap3.restore();
    }
    expect(existsSync(join(tmp, "check-report-22.json"))).toBe(true);
  });

  test("missing scratchpad logs a hint and exits 0", async () => {
    const base = makeRoot("absent");
    // Baseline the process-global first: an earlier test file in the same
    // runner process may have leaked process.exitCode = 1, which would say
    // nothing about this handler run.
    const prevExit = process.exitCode;
    process.exitCode = 0;
    const cap = capture();
    let exitAfter: unknown;
    try {
      await clean([], cfgFor(base));
      expect(cap.out()).toContain(`no scratchpad at ${scratchDir(base)}`);
      exitAfter = process.exitCode;
    } finally {
      cap.restore();
      process.exitCode = prevExit;
    }
    expect(exitAfter).not.toBe(1);
  });

  test("--apply deletes files and cov-* dirs, reports freed bytes, exits 0", async () => {
    const base = makeRoot("apply");
    seedScratch(base);
    const tmp = scratchDir(base);
    const prevExit = process.exitCode;
    process.exitCode = 0;
    const cap = capture();
    let exitAfter: unknown;
    try {
      await clean(["--apply"], cfgFor(base));
      const text = cap.out() + cap.err();
      expect(text).toContain("freed 3.5 KB across 8 artifact(s)");
      expect(text).toContain("   tmp: freed 10 B across 1 file(s)");
      // Read BEFORE the finally-restore below: process.exitCode is a process-
      // global other test files may have leaked a 1 into; the restored value
      // says nothing about this handler run.
      exitAfter = process.exitCode;
    } finally {
      cap.restore();
      process.exitCode = prevExit;
    }
    // Candidates gone (including the spill inside a kept cov dir)…
    expect(existsSync(join(tmp, "old.tmp"))).toBe(false);
    expect(existsSync(join(tmp, "cov-c"))).toBe(false);
    expect(existsSync(join(tmp, "cov-a", ".lcov.info.deadbeef.tmp"))).toBe(false);
    expect(existsSync(join(tmp, "inner", "lcov.extra.tmp"))).toBe(false);
    expect(existsSync(join(tmp, "jscpd-report.json"))).toBe(false);
    expect(existsSync(join(tmp, "jscpd", "jscpd-report.json"))).toBe(false);
    expect(existsSync(join(tmp, "jscpd-archive", "jscpd-report.json"))).toBe(true);
    expect(existsSync(join(tmp, "jscpd", "deep", "jscpd-report.json"))).toBe(true);
    expect(existsSync(join(tmp, "check-report-22.json"))).toBe(false);
    expect(existsSync(join(tmp, "check-report-21.json"))).toBe(false);
    // …keep-side intact.
    expect(existsSync(join(tmp, "fresh.tmp"))).toBe(true);
    expect(existsSync(join(tmp, "cov-a", "lcov.info"))).toBe(true);
    expect(existsSync(join(tmp, "cov-b", "lcov.info"))).toBe(true);
    expect(existsSync(join(tmp, "check-report-1.json"))).toBe(true);
    expect(existsSync(join(tmp, "check-report-20.json"))).toBe(true);
    expect(exitAfter).not.toBe(1);
  });

  test("--apply keeps going after an undeletable candidate and sets exitCode 1", async () => {
    // The failure is chmod-based, so it cannot be produced as root.
    if (typeof process.getuid === "function" && process.getuid() === 0) return;
    const base = makeRoot("failure");
    const tmp = scratchDir(base);
    makeDir(base, DEFAULT_SETTINGS.scratch.root, 0);
    makeFile(tmp, join("locked", "old.tmp"), 10, 10);
    makeFile(tmp, "free.tmp", 10, 10);
    chmodSync(join(tmp, "locked"), 0o555);
    const prevExit = process.exitCode;
    try {
      const cap = capture();
      try {
        await clean(["--apply"], cfgFor(base)); // resolves — no crash
        expect(process.exitCode).toBe(1);
        expect(cap.err()).toContain("failed to delete");
        expect(cap.err()).toContain(join(tmp, "locked", "old.tmp"));
        expect(cap.out() + cap.err()).toContain("freed 10 B across 1 artifact(s)");
      } finally {
        cap.restore();
      }
      expect(existsSync(join(tmp, "free.tmp"))).toBe(false);
      expect(existsSync(join(tmp, "locked", "old.tmp"))).toBe(true);
    } finally {
      chmodSync(join(tmp, "locked"), 0o755);
      process.exitCode = prevExit;
    }
  });

  test("--json prints only the JSON payload on stdout", async () => {
    const base = makeRoot("json");
    seedScratch(base);
    const cap = capture();
    try {
      await clean(["--json"], cfgFor(base));
      const parsed = JSON.parse(cap.out()) as {
        apply: boolean;
        totalCandidateCount: number;
        classes: { name: string; candidateCount: number; }[];
      };
      expect(parsed.apply).toBe(false);
      expect(parsed.totalCandidateCount).toBe(8);
      expect(parsed.classes).toHaveLength(4);
      expect(parsed.classes.find((c) => c.name === "tmp")?.candidateCount).toBe(1);
      expect(cap.err()).toBe(""); // nothing else leaked, not even log lines
    } finally {
      cap.restore();
    }
    expect(existsSync(join(scratchDir(base), "old.tmp"))).toBe(true);
  });

  test("scratch settings values drive the plan", async () => {
    const base = makeRoot("plumbing");
    const tmp = scratchDir(base);
    makeDir(base, DEFAULT_SETTINGS.scratch.root, 0);
    makeFile(tmp, "aged.tmp", 10, 2);
    makeFile(tmp, "young.tmp", 10, 0);
    for (const age of [1, 2, 3]) {
      makeDir(tmp, `cov-${age}`, age);
      makeFile(tmp, `cov-${age}/lcov.info`, 10, age);
    }
    for (const age of [1, 2, 3]) {
      makeFile(tmp, `check-report-${age}.json`, 10, age);
    }

    // Defaults keep everything here: 2d tmp < 7d, 3 cov dirs ≥ keep 2…
    const defaultScan = scanScratch(tmp, CFG, NOW);
    expect(pathsOf(defaultScan, "tmp", "candidates")).toEqual([]);
    expect(pathsOf(defaultScan, "lcov", "candidates")).toHaveLength(1);
    expect(pathsOf(defaultScan, "check-report", "candidates")).toEqual([]);

    // …tighter settings prune them: 1d tmp gate, keep 3 cov dirs, cap 1.
    const tight: Partial<GiwtSettings["scratch"]> = {
      tmpMaxAgeDays: 1,
      lcovKeepLatest: 3,
      checkReportKeep: 1,
    };
    const tightScan = scanScratch(tmp, { ...CFG, ...tight }, NOW);
    expect(pathsOf(tightScan, "tmp", "candidates")).toEqual([join(tmp, "aged.tmp")]);
    expect(pathsOf(tightScan, "lcov", "candidates")).toEqual([]);
    expect(pathsOf(tightScan, "check-report", "candidates")).toEqual([
      join(tmp, "check-report-2.json"),
      join(tmp, "check-report-3.json"),
    ]);

    // The handler picks the same settings up end-to-end.
    const cap = capture();
    try {
      await clean(["--dry-run", "--verbose"], cfgFor(base, tight));
      expect(cap.out()).toContain(`     ${join(tmp, "aged.tmp")}`);
    } finally {
      cap.restore();
    }
  });

  test("-h prints the usage matching the cli USAGE row", async () => {
    const base = makeRoot("help");
    const cap = capture();
    try {
      await clean(["-h"], cfgFor(base));
      const text = cap.out();
      expect(text).toContain("Usage: giwt clean [--dry-run] [--apply] [--json] [--verbose]");
      expect(text).toContain(
        "--dry-run   print the prune plan per class (default; nothing is deleted)",
      );
      expect(text).toContain("--apply     run the prune and report bytes freed");
      expect(text).toContain("--json      machine-readable plan/result on stdout");
      expect(text).toContain("--verbose   list every candidate path, not just per-class totals");
    } finally {
      cap.restore();
    }
  });

  test("unknown flag logs an error and exits 1", async () => {
    const base = makeRoot("badflag");
    const sentinel = exitSentinel();
    const cap = capture();
    try {
      await expect(clean(["--bogus"], cfgFor(base))).rejects.toThrow("__exit:1");
      expect(sentinel.codes).toEqual([1]);
      expect(cap.err()).toContain("unknown flag '--bogus'");
    } finally {
      cap.restore();
      sentinel.restore();
    }
  });
});
