// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for runCheck's run-dir check-report.json copy: the copy must
 * happen at gate time on pass AND fail, because success teardown removes
 * the worktree the report lives in
 * (FIX-referenced-artifacts-must-outlive-the-console).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeConfig } from "../../utils/config";
import { scratchRoot } from "../../utils/scratch-tmp";
import { DEFAULT_SETTINGS } from "../../utils/settings";
import { runCheck } from "./checks";

let root: string;
let runDir: string;

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(runDir, { recursive: true, force: true });
});

function fixtureConfig(checkCommand: string): WorktreeConfig {
  return {
    repoRoot: root,
    worktreeRoot: root,
    treeDir: root,
    settings: {
      ...DEFAULT_SETTINGS,
      commands: { ...DEFAULT_SETTINGS.commands, check: checkCommand },
    },
  };
}

function seedWorktree(): void {
  root = mkdtempSync(join(scratchRoot(), "giwt-checks-wt-"));
  runDir = mkdtempSync(join(scratchRoot(), "giwt-checks-run-"));
  mkdirSync(join(root, ".tmp"));
  writeFileSync(join(root, ".tmp", "check-report.json"), "{\"checks\":[]}");
}

describe("runCheck report capture", () => {
  test("copies check-report.json into the run dir on gate pass", () => {
    seedWorktree();
    const capturePath = join(runDir, "check.log");
    const reportCapturePath = join(runDir, "check-report.json");
    const ok = runCheck({
      wtPath: root,
      diffBase: "HEAD",
      config: fixtureConfig("echo ok"),
      capturePath,
      reportCapturePath,
    });
    expect(ok).toBe(true);
    expect(existsSync(capturePath)).toBe(true);
    expect(readFileSync(reportCapturePath, "utf8")).toBe("{\"checks\":[]}");
  });

  test("copies check-report.json into the run dir on gate failure", () => {
    seedWorktree();
    const reportCapturePath = join(runDir, "check-report.json");
    const ok = runCheck({
      wtPath: root,
      diffBase: "HEAD",
      config: fixtureConfig("false"),
      reportCapturePath,
    });
    expect(ok).toBe(false);
    expect(readFileSync(reportCapturePath, "utf8")).toBe("{\"checks\":[]}");
  });

  test("no report file in the worktree — no run-dir copy is created", () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-checks-wt-"));
    runDir = mkdtempSync(join(scratchRoot(), "giwt-checks-run-"));
    const reportCapturePath = join(runDir, "check-report.json");
    const ok = runCheck({
      wtPath: root,
      diffBase: "HEAD",
      config: fixtureConfig("echo ok"),
      reportCapturePath,
    });
    expect(ok).toBe(true);
    expect(existsSync(reportCapturePath)).toBe(false);
  });
});
