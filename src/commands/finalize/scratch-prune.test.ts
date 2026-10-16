// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for finalize's Step 6a scratchpad prune: the plan comes from the same
 * `scanScratch` `giwt clean` uses, `--dry-run` deletes nothing, symlinks are
 * never candidates, and a worktree with no scratch root is a no-op.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { WorktreeConfig } from "../../utils/config";
import { setOutputFormat } from "../../utils/output";
import { beginRun, finishActiveRun } from "../../utils/runlog";
import { scratchRoot } from "../../utils/scratch-tmp";
import { DEFAULT_SETTINGS } from "../../utils/settings";
import { pruneWorktreeScratch } from "./scratch-prune";

const DAY_MS = 24 * 60 * 60 * 1000;

let root: string;
let wtPath: string;
let outside: string;
let config: WorktreeConfig;

function captureOutput(): { lines: () => string; restore: () => void; } {
  const chunks: string[] = [];
  const push = (chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  };
  const outSpy = spyOn(process.stdout, "write").mockImplementation(push as never);
  const errSpy = spyOn(process.stderr, "write").mockImplementation(push as never);
  return {
    lines: () => chunks.join(""),
    restore: () => {
      outSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

/** Write a file under the worktree scratchpad and backdate it by `ageDays`. */
function aged(relative: string, content: string, ageDays: number): string {
  const path = join(wtPath, DEFAULT_SETTINGS.scratch.root, relative);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
  const when = (Date.now() - ageDays * DAY_MS) / 1000;
  utimesSync(path, when, when);
  return path;
}

function run(opts: { dryRun?: boolean; } = {}): string {
  const cap = captureOutput();
  try {
    pruneWorktreeScratch({ wtPath, config, dryRun: opts.dryRun ?? false });
  } finally {
    cap.restore();
  }
  return cap.lines();
}

beforeEach(() => {
  process.env.NO_COLOR = "1";
  setOutputFormat("simple");
  root = mkdtempSync(join(scratchRoot(), "giwt-prune-test-"));
  wtPath = join(root, "tree", "feat-x");
  outside = join(root, "outside");
  mkdirSync(join(wtPath, DEFAULT_SETTINGS.scratch.root), { recursive: true });
  mkdirSync(outside);
  config = {
    repoRoot: root,
    worktreeRoot: wtPath,
    treeDir: join(root, "tree"),
    settings: DEFAULT_SETTINGS,
  };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("finalize scratchpad prune", () => {
  test("deletes candidates the shared scanner selects and keeps the rest", () => {
    const staleReport = aged("check-report-old.json", "{}".repeat(300), 30);
    const freshReport = aged("check-report-fresh.json", "{}", 0);
    // checkReportKeep=20, so two root reports are both inside the cap.
    const staleTmp = aged("leftover.tmp", "x".repeat(100), 30);
    const freshTmp = aged("in-flight.tmp", "x", 0);

    const out = run();

    expect(out).toContain("Step 6a: Pruning scratchpad");
    expect(out).toContain("tmp: 1 artifact(s)");
    expect(existsSync(staleReport)).toBe(true); // under the keep cap — not a candidate
    expect(existsSync(staleTmp)).toBe(false); // aged .tmp — deleted
    expect(existsSync(freshTmp)).toBe(true); // under the age gate
    expect(existsSync(freshReport)).toBe(true);
  });

  test("reports bytes freed and counts them in the result", () => {
    aged("big.tmp", "x".repeat(4096), 30);
    const result = pruneWorktreeScratch({ wtPath, config, dryRun: false });
    expect(result.existed).toBe(true);
    expect(result.freedCount).toBe(1);
    expect(result.freedBytes).toBe(4096);
    expect(result.failures).toEqual([]);
  });

  test("--dry-run reports the plan and deletes nothing", () => {
    const stale = aged("leftover.tmp", "x".repeat(2048), 30);
    const out = run({ dryRun: true });
    expect(out).toContain("--prune-dry-run — scratchpad left untouched");
    expect(out).toContain("1 artifact(s)");
    expect(existsSync(stale)).toBe(true);

    const result = pruneWorktreeScratch({ wtPath, config, dryRun: true });
    expect(result.candidateCount).toBe(1);
    expect(result.freedCount).toBe(0);
    expect(result.freedBytes).toBe(0);
    expect(existsSync(stale)).toBe(true);
  });

  test("names the bytes the four scratch classes do not cover instead of pruning them", () => {
    aged("leftover.tmp", "x", 30);
    const runDir = join(wtPath, DEFAULT_SETTINGS.scratch.root, "run-1234-mv5abcde");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "test.log"), "x".repeat(8192));
    mkdirSync(join(runDir, "jscpd"), { recursive: true });
    writeFileSync(join(runDir, "jscpd", "jscpd-report.json"), "{}".repeat(500));

    const out = run();

    expect(out).toContain("outside the 4 scratch classes");
    expect(out).toContain("run-1234-mv5abcde");
    // A per-run dir is neither an aged root *.tmp nor a root-level
    // jscpd-report.json, so it survives the prune.
    expect(existsSync(runDir)).toBe(true);
  });

  test("never follows a symlink out of the scratchpad", () => {
    const secret = join(outside, "precious.txt");
    writeFileSync(secret, "keep me");
    symlinkSync(outside, join(wtPath, DEFAULT_SETTINGS.scratch.root, "link-to-outside"));
    symlinkSync(secret, join(wtPath, DEFAULT_SETTINGS.scratch.root, "link-to-file.tmp"));
    const when = (Date.now() - 30 * DAY_MS) / 1000;
    utimesSync(join(wtPath, DEFAULT_SETTINGS.scratch.root, "link-to-file.tmp"), when, when);

    run();

    expect(existsSync(secret)).toBe(true);
    expect(existsSync(outside)).toBe(true);
  });

  test("a worktree with no scratch root is a no-op", () => {
    const bare = join(root, "tree", "bare");
    mkdirSync(join(bare, DEFAULT_SETTINGS.scratch.root), { recursive: true });
    rmSync(join(bare, DEFAULT_SETTINGS.scratch.root), { recursive: true, force: true });
    const cap = captureOutput();
    let result;
    try {
      result = pruneWorktreeScratch({ wtPath: bare, config, dryRun: false });
    } finally {
      cap.restore();
    }
    expect(cap.lines()).toContain("nothing to prune");
    expect(result.existed).toBe(false);
    expect(result.freedCount).toBe(0);
  });

  test("scratch files are pruned under [scratch].root, not hardcoded .tmp", () => {
    const customRoot = ".scratchpad";
    const settings = {
      ...DEFAULT_SETTINGS,
      scratch: { ...DEFAULT_SETTINGS.scratch, root: customRoot },
    };
    mkdirSync(join(wtPath, customRoot), { recursive: true });
    const stale = join(wtPath, customRoot, "old.tmp");
    writeFileSync(stale, "x".repeat(512));
    const when = (Date.now() - 30 * DAY_MS) / 1000;
    utimesSync(stale, when, when);

    const result = pruneWorktreeScratch({
      wtPath,
      config: { ...config, settings },
      dryRun: false,
    });

    expect(result.root).toBe(join(wtPath, customRoot));
    expect(result.freedCount).toBe(1);
    expect(existsSync(stale)).toBe(false);
  });

  test("a scratchpad that is itself a symlink is never followed", () => {
    const outsideRoot = join(root, "outside-scratch");
    mkdirSync(outsideRoot, { recursive: true });
    const victim = join(outsideRoot, "old.tmp");
    writeFileSync(victim, "x".repeat(1024));
    const when = (Date.now() - 30 * DAY_MS) / 1000;
    utimesSync(victim, when, when);
    rmSync(join(wtPath, DEFAULT_SETTINGS.scratch.root), { recursive: true, force: true });
    symlinkSync(outsideRoot, join(wtPath, DEFAULT_SETTINGS.scratch.root));

    const cap = captureOutput();
    let result;
    try {
      result = pruneWorktreeScratch({ wtPath, config, dryRun: false });
    } finally {
      cap.restore();
    }

    expect(existsSync(victim)).toBe(true);
    expect(result.freedCount).toBe(0);
    expect(result.candidateCount).toBe(0);
  });

  test("deletes a candidate directory recursively", () => {
    const scratch = join(wtPath, DEFAULT_SETTINGS.scratch.root);
    aged("cov-older/lcov.info", "z".repeat(1024), 40);
    aged("cov-repro/lcov.info", "x".repeat(4096), 30);
    aged("cov-repro/nested/second.info", "y".repeat(2048), 30);
    // The lcov class ranks DIRECTORIES by mtime, and writing inside them just
    // bumped both to "now" — order them explicitly.
    const at = (days: number): number => (Date.now() - days * DAY_MS) / 1000;
    utimesSync(join(scratch, "cov-older"), at(40), at(40));
    utimesSync(join(scratch, "cov-repro"), at(30), at(30));

    const result = pruneWorktreeScratch({ wtPath, config, dryRun: false });

    // keep-latest is 2 and only 2 exist, so nothing is a candidate.
    expect(existsSync(join(scratch, "cov-older"))).toBe(true);
    expect(result.freedCount).toBe(0);

    // A third, older dir pushes cov-older past the cap: the whole DIRECTORY
    // goes, nested contents included, and only that directory.
    aged("cov-ancient/lcov.info", "w".repeat(512), 50);
    utimesSync(join(scratch, "cov-ancient"), at(50), at(50));
    const after = pruneWorktreeScratch({ wtPath, config, dryRun: false });

    expect(existsSync(join(scratch, "cov-ancient"))).toBe(false);
    expect(existsSync(join(scratch, "cov-older"))).toBe(true);
    expect(existsSync(join(scratch, "cov-repro", "nested", "second.info"))).toBe(true);
    expect(after.freedCount).toBe(1);
    expect(after.failures).toEqual([]);
  });

  test("a candidate it cannot delete is recorded, not thrown", () => {
    if (process.getuid?.() === 0) return; // root ignores the mode bits
    const scratchDir = join(wtPath, DEFAULT_SETTINGS.scratch.root);
    const stale = aged("locked/old.tmp", "x".repeat(1024), 30);
    chmodSync(join(scratchDir, "locked"), 0o500); // no write bit on the parent

    let result;
    try {
      result = pruneWorktreeScratch({ wtPath, config, dryRun: false });
    } finally {
      chmodSync(join(scratchDir, "locked"), 0o700);
    }

    expect(existsSync(stale)).toBe(true);
    expect(result.freedCount).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.path).toBe(stale);
  });

  test("reports the bytes freed in the run record", () => {
    aged("report/leftover.tmp", "x".repeat(2048), 30);
    const recorder = beginRun(config, "finalize", ["feature"], null, "feature");
    expect(recorder).not.toBeNull();
    try {
      run();
    } finally {
      finishActiveRun(0);
    }

    const meta = JSON.parse(readFileSync(join(recorder!.dir, "meta.json"), "utf-8")) as {
      outcome?: { scratch?: string; };
    };
    expect(meta.outcome?.scratch).toBe("freed 2.0 KB across 1 scratch artifact(s)");
  });
});
