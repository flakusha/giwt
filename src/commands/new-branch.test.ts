// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the missing-base-ref error path of `giwt new-branch`.
 *
 * Regression target (ticket FIX-errors-carry-no-remedy): the old error was
 * just "base 'dev' does not exist" — no candidates, no giwt.toml hint — so
 * an agent had to rediscover valid inputs by trial. The fix lists the
 * existing branch candidates, points at the [branches] root override in
 * giwt.toml, and names the explicit-base escape hatch.
 *
 * Strategy: build a real tiny git repo in /tmp (master + one extra branch,
 * deliberately NO `dev`, the settings default root) and drive the real
 * `execute()` entry point with a bad base — then again with no base at all
 * so the default root is the missing ref, mirroring the ticket evidence.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { execute } from "./new-branch";

let root: string;
let config: WorktreeConfig;

function run(cmd: string[], cwd: string): void {
  const proc = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(`fixture command failed: ${cmd.join(" ")}: ${proc.stderr.toString()}`);
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "giwt-new-branch-"));
  run(["git", "init", "--initial-branch=master"], root);
  run(["git", "config", "user.email", "test@example.com"], root);
  run(["git", "config", "user.name", "Test"], root);
  run(["git", "commit", "--allow-empty", "-m", "base"], root);
  run(["git", "branch", "staging"], root);
  config = {
    repoRoot: root,
    worktreeRoot: root,
    treeDir: join(root, "tree"),
    settings: DEFAULT_SETTINGS,
  };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * Capture log/raw output and replace process.exit with a throwing stub.
 * `execute()` runs synchronously up to the exit, so the rejection carries
 * the stub error while the captured output is already complete.
 */
function installSpies(): { collect: () => string; restore: () => void; } {
  const outSpy = spyOn(process.stdout, "write");
  const errSpy = spyOn(process.stderr, "write");
  const exitSpy = spyOn(process, "exit").mockImplementation(
    ((code?: number) => {
      throw new Error(`__exit__:${code}`);
    }) as typeof process.exit,
  );
  outSpy.mockImplementation(() => true);
  errSpy.mockImplementation(() => true);
  return {
    collect: () =>
      [
        ...outSpy.mock.calls.map((args) => String(args[0])),
        ...errSpy.mock.calls.map((args) => String(args[0])),
      ].join(""),
    restore: () => {
      outSpy.mockRestore();
      errSpy.mockRestore();
      exitSpy.mockRestore();
    },
  };
}

/** Await a command that must abort via process.exit(1); returns all output. */
async function runExpectExit1(runner: () => Promise<void>): Promise<string> {
  const spies = installSpies();
  try {
    let aborted = false;
    try {
      await runner();
    } catch (err) {
      expect((err as Error).message).toBe("__exit__:1");
      aborted = true;
    }
    expect(aborted).toBe(true);
    return spies.collect();
  } finally {
    spies.restore();
  }
}

describe("new-branch missing-base error (FIX-errors-carry-no-remedy)", () => {
  test("explicit missing base lists candidates, giwt.toml override, and escape hatch", async () => {
    const out = await runExpectExit1(() =>
      execute(["tooling-plan-validate-integration", "no-such-base"], config)
    );
    expect(out).toContain("base 'no-such-base' does not exist");
    // Existing candidate base refs are listed.
    expect(out).toContain("Existing branches you can base on:");
    expect(out).toContain("master");
    expect(out).toContain("staging");
    // The [branches] root override in giwt.toml is mentioned.
    expect(out).toContain("[branches] root");
    expect(out).toContain("giwt.toml");
    // An explicit command is offered as the actionable next step.
    expect(out).toContain("giwt new-branch tooling-plan-validate-integration <base>");
  });

  test("default (configured) base missing reports the configured root name", async () => {
    // DEFAULT_SETTINGS.branches.root is "dev"; the fixture has no dev
    // branch, mirroring the ticket evidence (repo branches from master).
    expect(DEFAULT_SETTINGS.branches.root).toBe("dev");
    const out = await runExpectExit1(() => execute(["some-new-branch"], config));
    expect(out).toContain("base 'dev' does not exist");
    expect(out).toContain("[branches] root");
    expect(out).toContain("(currently 'dev')");
    expect(out).toContain("master");
  });
});
