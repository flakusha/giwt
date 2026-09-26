// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for `giwt issues --state` forwarding (FIX-giwt-issues-silently-drops-state).
 *
 * Coverage (real git-issue CLI, real fixture repo — same convention as
 * gi.test.ts, deliberately NOT mock.module):
 *   - default listing is open-only (backcompat)
 *   - --state closed / -s closed / --state=closed list closed issues
 *   - --state=all lists both states
 *   - unknown flag exits 1 with a usage line instead of silently succeeding
 *   - invalid/missing --state value exits 1
 *   - >50 results are capped with an explicit truncation notice (--all lifts it)
 */

import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WorktreeConfig } from "../utils/config";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { issues } from "./issues";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeConfig(): WorktreeConfig {
  const root = mkdtempSync(join(tmpdir(), "giwt-issues-"));
  tempRoots.push(root);
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "giwt-test@localhost"]);
  execFileSync("git", ["-C", root, "config", "user.name", "giwt test"]);
  return { repoRoot: root, worktreeRoot: root, treeDir: root, settings: DEFAULT_SETTINGS };
}

function createIssue(root: string, title: string): string {
  const out = execFileSync("git", ["-C", root, "issue", "create", title, "-m", "body"], {
    encoding: "utf8",
  });
  const hash = out.match(/[0-9a-f]{7,40}/)?.[0];
  if (!hash) throw new Error(`could not extract issue hash from: ${out}`);
  return hash;
}

function closeIssue(root: string, hash: string): void {
  execFileSync("git", ["-C", root, "issue", "state", hash, "--close"], { encoding: "utf8" });
}

type Captured = { out: string; err: string; exits: number[]; restore(): void; };

function capture(): Captured {
  const outs: string[] = [];
  const errs: string[] = [];
  const exits: number[] = [];
  const outSpy = spyOn(process.stdout, "write").mockImplementation(
    ((chunk: unknown) => (outs.push(String(chunk)), true)) as never,
  );
  const errSpy = spyOn(process.stderr, "write").mockImplementation(
    ((chunk: unknown) => (errs.push(String(chunk)), true)) as never,
  );
  const origExit = process.exit;
  process.exit = ((code?: number): never => {
    exits.push(code ?? 0);
    throw new Error(`__exit:${code ?? 0}`);
  }) as never;
  return {
    get out(): string {
      return outs.join("");
    },
    get err(): string {
      return errs.join("");
    },
    get exits(): number[] {
      return exits;
    },
    restore(): void {
      outSpy.mockRestore();
      errSpy.mockRestore();
      process.exit = origExit;
    },
  };
}

async function run(args: string[], config: WorktreeConfig): Promise<Captured> {
  const cap = capture();
  try {
    await issues(args, config);
  } catch {
    // __exit sentinel — surfaced via cap.exits
  }
  cap.restore();
  return cap;
}

describe("issues --state", () => {
  it("defaults to open-only", async () => {
    const config = makeConfig();
    const openHash = createIssue(config.repoRoot, "open probe");
    closeIssue(config.repoRoot, createIssue(config.repoRoot, "closed probe"));
    const cap = await run([], config);
    expect(cap.out).toContain("issues (1):");
    expect(cap.out).toContain(openHash);
    expect(cap.out).not.toContain("closed probe");
  });

  it("--state closed lists closed issues", async () => {
    const config = makeConfig();
    const closedHash = createIssue(config.repoRoot, "closed probe");
    closeIssue(config.repoRoot, closedHash);
    createIssue(config.repoRoot, "open probe");
    const cap = await run(["--state", "closed"], config);
    expect(cap.out).toContain("issues (1):");
    expect(cap.out).toContain(closedHash);
    expect(cap.out).not.toContain("open probe");
  });

  it("-s closed and --state=closed forms work", async () => {
    const config = makeConfig();
    const closedHash = createIssue(config.repoRoot, "closed probe");
    closeIssue(config.repoRoot, closedHash);
    for (const args of [["-s", "closed"], ["--state=closed"]]) {
      const cap = await run(args, config);
      expect(cap.out).toContain(closedHash);
    }
  });

  it("--state=all lists both states", async () => {
    const config = makeConfig();
    const openHash = createIssue(config.repoRoot, "open probe");
    const closedHash = createIssue(config.repoRoot, "closed probe");
    closeIssue(config.repoRoot, closedHash);
    const cap = await run(["--state", "all"], config);
    expect(cap.out).toContain("issues (2):");
    expect(cap.out).toContain(openHash);
    expect(cap.out).toContain(closedHash);
  });

  it("empty registry reports no issues", async () => {
    const config = makeConfig();
    const cap = await run([], config);
    expect(cap.out).toContain("no issues found");
  });

  it("unknown flag exits 1 with a usage line", async () => {
    const config = makeConfig();
    const cap = await run(["--bogus"], config);
    expect(cap.exits).toEqual([1]);
    expect(cap.err).toContain("unknown flag '--bogus'");
    expect(cap.out).toContain("Usage: giwt issues");
  });

  it("invalid --state value exits 1", async () => {
    const config = makeConfig();
    for (const args of [["--state", "bogus"], ["--state=bogus"], ["--state", "--all"]]) {
      const cap = await run(args, config);
      expect(cap.exits).toEqual([1]);
      expect(cap.err).toContain("invalid --state");
      expect(cap.out).toContain("Usage: giwt issues");
    }
  });

  it("missing --state value exits 1", async () => {
    const config = makeConfig();
    const cap = await run(["--state"], config);
    expect(cap.exits).toEqual([1]);
    expect(cap.err).toContain("missing value for '--state'");
  });

  it("caps at 50 with a truncation notice; --all lifts the cap", async () => {
    const config = makeConfig();
    for (let n = 0; n < 52; n++) {
      createIssue(config.repoRoot, `probe issue ${n}`);
    }
    // Listing order is not guaranteed; derive which two titles the cap hides.
    const capped = await run(["--state", "all"], config);
    const capAll = await run(["--state", "all", "--all"], config);
    expect(capped.out).toContain("issues (50 of 52, 2 hidden — use --all):");
    expect(capAll.out).toContain("issues (52):");
    const shownTitles = capped.out
      .split("\n")
      .filter((line) => /^[0-9a-f]{7,40} /.test(line))
      .map((line) => line.replace(/^[0-9a-f]{7,40} \S+ /, ""));
    const allTitles = capAll.out
      .split("\n")
      .filter((line) => /^[0-9a-f]{7,40} /.test(line))
      .map((line) => line.replace(/^[0-9a-f]{7,40} \S+ /, ""));
    expect(shownTitles.length).toBe(50);
    expect(allTitles.length).toBe(52);
    const hidden = allTitles.filter((title) => !shownTitles.includes(title));
    expect(hidden.length).toBe(2);
  }, 30000);
});
