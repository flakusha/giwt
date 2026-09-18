// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the `gi` git-issue passthrough (FIX-gi-passthrough-contract).
 *
 * Coverage (real git-issue CLI, real fixture repo — the ticket explicitly
 * demands verification against the actual git-issue contract, not an
 * assumed one):
 *   - success: `gi show <hash>` forwards verbatim and git-issue's stdout is
 *     forwarded untouched to giwt's stdout
 *   - failure: the error carries the FULL forwarded command, git-issue's
 *     own rejection detail, the verified usage line, and the close remedy
 *     — never a truncated fragment
 *
 * Deliberately NOT mock.module: a module-level mock leaks across test files
 * in the same bun process (observed as poisoned git output in unrelated
 * suites) and is file-order dependent. PATH shimming is also impossible:
 * Bun.spawnSync resolves executables from the PATH snapshotted at startup.
 */

import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WorktreeConfig } from "../utils/config";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { gi } from "./gi";

const tempRoots: string[] = [];

function makeConfig(): WorktreeConfig {
  const root = mkdtempSync(join(tmpdir(), "giwt-gi-"));
  tempRoots.push(root);
  execFileSync("git", ["init", "-q", root]);
  // Hermetic identity: git-issue commits, and the harness env may have none.
  execFileSync("git", ["-C", root, "config", "user.email", "giwt-test@localhost"]);
  execFileSync("git", ["-C", root, "config", "user.name", "giwt test"]);
  return { repoRoot: root, worktreeRoot: root, treeDir: root, settings: DEFAULT_SETTINGS };
}

function createIssue(config: WorktreeConfig, title: string): string {
  const out = execFileSync("git", ["-C", config.repoRoot, "issue", "create", title, "-m", "body"], {
    encoding: "utf8",
  });
  const hash = out.match(/[0-9a-f]{7,40}/)?.[0];
  if (!hash) throw new Error(`could not extract issue hash from: ${out}`);
  return hash;
}

function captureFailure(run: () => Promise<void>): Promise<unknown> {
  return run().then(
    () => {
      throw new Error("expected gi to throw");
    },
    (error: unknown) => error,
  );
}

async function captureStdout(run: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const push = (chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  };
  const outSpy = spyOn(process.stdout, "write").mockImplementation(push as never);
  try {
    await run();
  } finally {
    outSpy.mockRestore();
  }
  return chunks.join("");
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("gi passthrough", () => {
  it("forwards args verbatim to git issue and prints its stdout", async () => {
    const config = makeConfig();
    const hash = createIssue(config, "passthrough probe");
    const out = await captureStdout(() => gi(["show", hash], config));
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain(hash);
  });

  it("failure prints the full forwarded command, the rejection, and the real usage", async () => {
    const config = makeConfig();
    const hash = createIssue(config, "close probe");
    const caught = await captureFailure(() => gi(["close", hash], config));
    expect(caught).toBeInstanceOf(Error);
    const msg = caught instanceof Error ? caught.message : String(caught);
    // The full forwarded command, not a truncated fragment:
    expect(msg).toContain(`git issue close ${hash} failed`);
    // git-issue's own rejection is preserved verbatim:
    expect(msg).toContain("is not a git-issue command");
    // The usage line verified against git-issue 1.3.3 plus the close remedy:
    expect(msg).toContain(
      "usage: git issue <command> [<args>] with command: "
        + "create ls show comment edit state import export sync merge fsck init version",
    );
    expect(msg).toContain("giwt gi state <issue-id> --close");
  });

  it("failure carries the full command and usage for unknown issues too", async () => {
    const config = makeConfig();
    const caught = await captureFailure(() => gi(["show", "beefcafe"], config));
    const msg = caught instanceof Error ? caught.message : String(caught);
    expect(msg).toContain("git issue show beefcafe failed");
    expect(msg).toContain("usage: git issue <command> [<args>]");
    expect(msg).toContain("giwt gi state <issue-id> --close");
  });
});
