// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the report command: renders one row per worktree from its check
 * report, degrades gracefully for missing and malformed reports, and skips
 * the worktree sweep entirely when no tree/ exists.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { setOutputFormat } from "../utils/output";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { report } from "./report";

let root: string;
let treeDir: string;
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

function reportJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    branch: "feat/a",
    gitHead: "abc1234",
    runId: "run-1",
    mode: "full",
    gates: { lint: { status: "passed" }, test: { status: "failed" }, gen: { status: "skipped" } },
    passed: true,
    timestamp: "2026-01-01T00:00:00Z",
    ...overrides,
  });
}

beforeEach(() => {
  // Report output uses ANSI color codes that depend on the runtime
  // environment (NO_COLOR / CI / OMP). Bun's test runner does not set
  // any of those, so the raw output contains the escape codes. Disable
  // colors for the test process so the assertions match the plain-text
  // labels the report command actually prints (e.g. `(main) no report`).
  process.env.NO_COLOR = "1";
  setOutputFormat("simple");
  root = mkdtempSync(join(tmpdir(), "giwt-report-test-"));
  mkdirSync(join(root, ".tmp"), { recursive: true });
  treeDir = resolve(root, "tree");
  mkdirSync(treeDir);
  config = { repoRoot: root, worktreeRoot: root, treeDir, settings: DEFAULT_SETTINGS };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("report", () => {
  test("prints no-report rows and stops when tree/ is absent", async () => {
    rmSync(treeDir, { recursive: true, force: true });
    const cap = captureOutput();
    try {
      await report([], config);
    } finally {
      cap.restore();
    }
    const out = cap.lines();
    expect(out).toContain("Check reports across worktrees");
    expect(out).toContain("(main) no report");
    expect(out).toContain("No tree/ directory found");
  });

  test("renders the main report with per-gate statuses", async () => {
    writeFileSync(join(root, DEFAULT_SETTINGS.paths.checkReport), reportJson());
    const cap = captureOutput();
    try {
      await report([], config);
    } finally {
      cap.restore();
    }
    const out = cap.lines();
    expect(out).toContain("(main) PASSED");
    expect(out).toContain("feat/a @ abc1234");
    expect(out).toContain("run: run-1 | mode: full");
    expect(out).toContain("lint: passed");
    expect(out).toContain("test: failed");
    expect(out).toContain("gen: skipped");
  });

  test("renders FAILED for a report that did not pass and ? for unknown statuses", async () => {
    writeFileSync(
      join(root, DEFAULT_SETTINGS.paths.checkReport),
      reportJson({ passed: false, gates: { mystery: { status: "weird" } } }),
    );
    const cap = captureOutput();
    try {
      await report([], config);
    } finally {
      cap.restore();
    }
    const out = cap.lines();
    expect(out).toContain("(main) FAILED");
    expect(out).toContain("mystery: ? weird");
  });

  test("flags a malformed main report instead of aborting", async () => {
    writeFileSync(join(root, DEFAULT_SETTINGS.paths.checkReport), "{not json");
    const cap = captureOutput();
    try {
      await report([], config);
    } finally {
      cap.restore();
    }
    expect(cap.lines()).toContain("(main) malformed report");
  });

  test("rejects non-object and gateless payloads as malformed", async () => {
    writeFileSync(join(root, DEFAULT_SETTINGS.paths.checkReport), "42");
    const cap = captureOutput();
    try {
      await report([], config);
    } finally {
      cap.restore();
    }
    expect(cap.lines()).toContain("report root is not a JSON object");
  });

  test("rejects an array root as malformed", async () => {
    writeFileSync(join(root, DEFAULT_SETTINGS.paths.checkReport), "[]");
    const cap = captureOutput();
    try {
      await report([], config);
    } finally {
      cap.restore();
    }
    expect(cap.lines()).toContain("report root is not a JSON object");
  });

  test("rejects a missing gates section as malformed", async () => {
    writeFileSync(join(root, DEFAULT_SETTINGS.paths.checkReport), JSON.stringify({ branch: "x" }));
    const cap = captureOutput();
    try {
      await report([], config);
    } finally {
      cap.restore();
    }
    expect(cap.lines()).toContain("missing or invalid 'gates' section");
  });

  test("rejects a non-object gates section as malformed", async () => {
    writeFileSync(join(root, DEFAULT_SETTINGS.paths.checkReport), JSON.stringify({ gates: [] }));
    const cap = captureOutput();
    try {
      await report([], config);
    } finally {
      cap.restore();
    }
    expect(cap.lines()).toContain("missing or invalid 'gates' section");
  });

  test("renders a mixed set of worktree rows", async () => {
    writeFileSync(join(root, DEFAULT_SETTINGS.paths.checkReport), reportJson());
    mkdirSync(resolve(treeDir, "good"));
    mkdirSync(resolve(treeDir, "good", ".tmp"), { recursive: true });
    writeFileSync(resolve(treeDir, "good", DEFAULT_SETTINGS.paths.checkReport), reportJson());
    mkdirSync(resolve(treeDir, "noreport"));
    mkdirSync(resolve(treeDir, "bad", ".tmp"), { recursive: true });
    writeFileSync(resolve(treeDir, "bad", DEFAULT_SETTINGS.paths.checkReport), "nope");
    const cap = captureOutput();
    try {
      await report([], config);
    } finally {
      cap.restore();
    }
    const out = cap.lines();
    expect(out).toContain("good PASSED");
    expect(out).toContain("noreport no report");
    expect(out).toContain("bad malformed report");
  });
});
