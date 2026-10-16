// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Shared testkit helpers for colocated bun tests. Parallel-safe by
 * construction: every call allocates fresh resources under scratchRoot(),
 * there is no module-global registry and no fixed/shared paths, and the
 * caller owns cleanup in its own finally/afterEach.
 */

import { spyOn } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { isolatedGitEnv } from "../utils/git";
import { scratchRoot } from "../utils/scratch-tmp";

export interface Capture {
  /** Everything written to process.stdout while captured. */
  out: () => string;
  /** Everything written to process.stderr while captured. */
  err: () => string;
  /** Combined stdout+stderr stream, in write order. */
  lines: () => string;
  /** The ONLY spy-unwind path — call it in finally/afterEach (or use
   *  withCapture, which restores even when fn throws). */
  restore: () => void;
}

/** Capture process.stdout/process.stderr writes (the logger's raw channel —
 *  console.log spies see nothing). */
export function captureOutput(): Capture {
  const chunks: string[] = [];
  const push = (chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  };
  const outSpy = spyOn(process.stdout, "write").mockImplementation(push as never);
  const errSpy = spyOn(process.stderr, "write").mockImplementation(push as never);
  return {
    out: () => outSpy.mock.calls.map((args) => String(args[0])).join(""),
    err: () => errSpy.mock.calls.map((args) => String(args[0])).join(""),
    lines: () => chunks.join(""),
    restore: () => {
      outSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

/** Run `fn` with an open capture; restore() runs even when fn throws.
 *  Returns fn's result plus the captured out/err streams. */
export async function withCapture<R>(
  fn: (capture: Capture) => R | Promise<R>,
): Promise<{ err: string; out: string; result: R; }> {
  const capture = captureOutput();
  try {
    const result = await fn(capture);
    return { result, out: capture.out(), err: capture.err() };
  } finally {
    capture.restore();
  }
}

export interface GitRepoOptions {
  /** Extra branches to create at HEAD (plus the seeded `main`). */
  branches?: string[];
  /** Committer identity to configure; set `false` to leave the repo
   *  without one (for tests that exercise the missing-identity path). */
  identity?: false | { email?: string; name?: string; };
}

/** Fresh mkdtemp git repo under scratchRoot(): `git init -b main`, a test
 *  identity and an initial empty commit (so `branches:` can branch off
 *  HEAD) unless `identity: false`, and any requested branches. The caller
 *  rmSync's the returned root in its own finally/afterEach. */
export function makeGitRepo(slug: string, { branches, identity }: GitRepoOptions = {}): string {
  const root = mkdtempSync(join(scratchRoot(), `giwt-${slug}-`));
  git(root, "init", "-q", "-b", "main");
  if (identity !== false) {
    git(root, "config", "user.email", identity?.email ?? "giwt-test@localhost");
    git(root, "config", "user.name", identity?.name ?? "giwt test");
    git(root, "commit", "--allow-empty", "-qm", "init");
    for (const branch of branches ?? []) git(root, "branch", branch);
  }
  return root;
}

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
    env: isolatedGitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
}
