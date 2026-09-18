// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Argument-contract coverage for `ticket`: type/title/priority validation,
 * usage text, and exit codes. The worktree-placement contract and the real
 * git-issue creation path live in ticket.test.ts.
 *
 * Each case runs inside its own scratch repo (ticket resolves the plan root
 * from cwd) with child git spawned under isolatedGitEnv().
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WorktreeConfig } from "../utils/config";
import { isolatedGitEnv } from "../utils/git";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { ticket } from "./ticket";

const temps: string[] = [];
let prevCwd = process.cwd();

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: isolatedGitEnv(),
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
}

/** Fixture repo; chdir in so ticket's getWorktreeRoot resolves here. */
function makeRepo(): WorktreeConfig {
  const root = mkdtempSync(join(tmpdir(), "giwt-ticket-flags-"));
  temps.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "test");
  writeFileSync(join(root, "f.txt"), "x\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  prevCwd = process.cwd();
  process.chdir(root);
  return { repoRoot: root, worktreeRoot: root, treeDir: root, settings: DEFAULT_SETTINGS };
}

function capture(): { text: () => string; restore: () => void; } {
  const chunks: string[] = [];
  const push = (chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  };
  const out = spyOn(process.stdout, "write").mockImplementation(push as never);
  const err = spyOn(process.stderr, "write").mockImplementation(push as never);
  return {
    text: () => chunks.join(""),
    restore: () => {
      out.mockRestore();
      err.mockRestore();
    },
  };
}

/** Run ticket() expecting a process.exit(1) sentinel; returns its output. */
async function expectExit1(args: string[], config: WorktreeConfig): Promise<string> {
  const cap = capture();
  const originalExit = process.exit;
  process.exit = ((code: number) => {
    throw new Error(`__exit:${code}`);
  }) as never;
  try {
    await ticket(args, config);
    throw new Error("expected process.exit");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith("__exit:")) throw error;
    expect(message).toBe("__exit:1");
  } finally {
    process.exit = originalExit;
    cap.restore();
  }
  return cap.text();
}

afterEach(() => {
  try {
    process.chdir(prevCwd);
  } catch {
    // fixture cwd may already be gone
  }
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("ticket argument contract", () => {
  test("missing type/title prints usage and exits 1", async () => {
    const config = makeRepo();
    const out = await expectExit1(["TASK"], config);
    expect(out).toContain("type and title required");
    expect(out).toContain("Usage: ticket <TYPE> <title>");
    expect(out).toContain("TYPE: BUG, FEAT, FIX, IDEA, TASK, SOL, INFRA");
  });

  test("unknown type lists the valid types and exits 1", async () => {
    const config = makeRepo();
    const out = await expectExit1(["NOPE", "some title"], config);
    expect(out).toContain("unknown type 'NOPE'");
    expect(out).toContain("use: BUG, FEAT, FIX, IDEA, TASK, SOL, INFRA");
  });

  test("unknown priority lists the valid priorities and exits 1", async () => {
    const config = makeRepo();
    const out = await expectExit1(["TASK", "prio probe", "body", "--priority", "ASAP"], config);
    expect(out).toContain("unknown priority 'ASAP'");
    expect(out).toContain("use: low, medium, high, critical");
  });
});
