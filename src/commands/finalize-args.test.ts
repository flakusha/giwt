// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
/**
 * Unit tests for `parseFinalizeArgs` in src/commands/finalize.ts.
 *
 * Scope: arg-parsing for `worktree finalize`, with focus on the
 * --gates / --skip-gates forwarding contract. The function is exported
 * from finalize.ts precisely so this can be tested in isolation.
 *
 * What we cover:
 *  - default values when no flags are passed
 *  - branch positional argument extraction
 *  - --gates / --skip-gates capture (verbatim, no CSV splitting here;
 *    the runner parses them)
 *  - mutual exclusion still rejects (we restore process.exit between
 *    tests via the spy mechanism below)
 *  - --merge-strategy and --force / -f
 *
 * What we do NOT cover:
 *  - Validation of merge strategy value (calls process.exit directly).
 *    To exercise that branch without dying, wrap parseFinalizeArgs in
 *    a mock that intercepts process.exit. We skip it here — the
 *    behavioral gate (runner rejects unknown gates) covers the
 *    user-facing failure path.
 *
 * Resource contract (parallel-safe): the parseFinalizeArgs tests own nothing
 * (pure function). Each CLI-surface test owns ONE private mkdtemp checkout
 * under the shared scratch root, with its own TREE_DIR inside it — no fixed
 * paths, no shared mutable state, so the file is safe under parallel
 * execution. Teardown is in afterEach, which drains tempRoots unconditionally:
 * a failed CLI assertion still releases its checkout and cannot poison the
 * tests that follow it.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isolatedGitEnv } from "../utils/git";
import { scratchRoot } from "../utils/scratch-tmp";
import { parseFinalizeArgs } from "./finalize.ts";

const CLI = join(import.meta.dir, "..", "cli.ts");
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * `bun src/cli.ts finalize <args>` in a throwaway git repo, REPO_ROOT pinned.
 *
 * Every child process runs with isolatedGitEnv(), matching the convention in
 * abort.test.ts / finalize.test.ts: this file runs inside real finalize gates,
 * where git exports GIT_DIR/GIT_INDEX_FILE to the hook and the harness exports
 * OMP_/PI_ session vars. Measured under a poisoned ambient env the two styles
 * produced identical output here (REPO_ROOT pinning plus `git init <path>`
 * already overrides GIT_DIR), so this is convention-alignment and
 * defence-in-depth, NOT a fix for an observed failure. The suite passes 21/21
 * under GIT_DIR + GIT_INDEX_FILE + GIT_WORK_TREE + harness vars.
 *
 * No `git config user.*` is set on the fixture: neither CLI case reaches a
 * commit (both refuse during arg handling / worktree lookup), so an identity
 * would be dead weight — and a fixture identity written with the legacy
 * two-positional `git config <key> <value>` form is a persistent-config write
 * we have no reason to perform.
 */
function runFinalize(args: string[]): { out: string; code: number; } {
  const root = mkdtempSync(join(scratchRoot(), "giwt-finalize-dryrun-"));
  tempRoots.push(root);
  const env = isolatedGitEnv();
  execFileSync("git", ["init", "-q", root], { env });
  const proc = Bun.spawnSync(["bun", CLI, "finalize", ...args], {
    cwd: root,
    env: { ...env, REPO_ROOT: root, TREE_DIR: join(root, "tree") },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30000,
  });
  return {
    out: proc.stdout.toString() + proc.stderr.toString(),
    code: proc.exitCode ?? 1,
  };
}

describe("parseFinalizeArgs — defaults", () => {
  test("empty args returns sensible defaults", () => {
    const r = parseFinalizeArgs([]);
    expect(r.branch).toBe("");
    expect(r.mergeStrategy).toBe("rebase");
    expect(r.force).toBe(false);
    expect(r.gatesFilter).toBe("");
    expect(r.skipGatesFilter).toBe("");
    expect(r.jobs).toBe("");
  });
});

describe("parseFinalizeArgs — branch positional", () => {
  test("first non-flag arg becomes branch", () => {
    const r = parseFinalizeArgs(["my-feature-branch"]);
    expect(r.branch).toBe("my-feature-branch");
  });

  test("flags can precede or follow the branch", () => {
    const r1 = parseFinalizeArgs(["--force", "branch-a"]);
    const r2 = parseFinalizeArgs(["branch-a", "--force"]);
    expect(r1.branch).toBe("branch-a");
    expect(r2.branch).toBe("branch-a");
    expect(r1.force).toBe(true);
    expect(r2.force).toBe(true);
  });
});

describe("parseFinalizeArgs — --gates / --skip-gates forwarding", () => {
  test("--gates captures the next arg verbatim (no CSV splitting)", () => {
    const r = parseFinalizeArgs(["--gates", "md - lint,format - dprint"]);
    expect(r.gatesFilter).toBe("md - lint,format - dprint");
    expect(r.skipGatesFilter).toBe("");
  });

  test("--skip-gates captures the next arg verbatim", () => {
    const r = parseFinalizeArgs(["--skip-gates", "coverage - per-module line %"]);
    expect(r.skipGatesFilter).toBe("coverage - per-module line %");
    expect(r.gatesFilter).toBe("");
  });

  test("--gates with em-dash punctuation in name (regression: was a CSV-split trap)", () => {
    const r = parseFinalizeArgs(
      ["--gates", "frontend - banned patterns (ESLint-gap heuristic — advisory)"],
    );
    expect(r.gatesFilter).toBe(
      "frontend - banned patterns (ESLint-gap heuristic — advisory)",
    );
  });

  test("--gates followed by another flag uses empty string (matches the parser contract)", () => {
    // If the user omits the value: `args[++i]` reads the next flag token
    // as the value. We capture it verbatim and let the runner reject it
    // as an unknown gate name. This is documented grep-error feedback.
    const r = parseFinalizeArgs(["--gates", "--skip-gates"]);
    expect(r.gatesFilter).toBe("--skip-gates");
    // skipGatesFilter is still "" because --gates consumed the value
    // AND the next iteration sees --skip-gates without a value
    expect(r.skipGatesFilter).toBe("");
  });
});

describe("parseFinalizeArgs — --jobs forwarding", () => {
  test("absent by default so the check runner keeps its own serial default", () => {
    expect(parseFinalizeArgs(["branch-a"]).jobs).toBe("");
  });

  test("--jobs captures the next arg verbatim", () => {
    const r = parseFinalizeArgs(["--jobs", "4"]);
    expect(r.jobs).toBe("4");
  });

  test("--jobs does not leak into the branch positional", () => {
    const r = parseFinalizeArgs(["branch-a", "--jobs", "2"]);
    expect(r.branch).toBe("branch-a");
    expect(r.jobs).toBe("2");
  });

  test("composes with --gates", () => {
    const r = parseFinalizeArgs(["--gates", "md - lint", "--jobs", "2"]);
    expect(r.gatesFilter).toBe("md - lint");
    expect(r.jobs).toBe("2");
  });
});

describe("parseFinalizeArgs — dry-run flags never take the branch slot", () => {
  // BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the-branch-name:
  // both flags were unhandled, so the leading form (`finalize --dry-run <branch>`)
  // put the flag itself in the positional branch and died with
  // `no worktree found for branch '--dry-run'`.
  test("--prune-dry-run leading", () => {
    expect(parseFinalizeArgs(["--prune-dry-run", "feat-x"]).branch).toBe("feat-x");
  });

  test("--prune-dry-run trailing", () => {
    expect(parseFinalizeArgs(["feat-x", "--prune-dry-run"]).branch).toBe("feat-x");
  });

  test("--dry-run leading", () => {
    expect(parseFinalizeArgs(["--dry-run", "feat-x"]).branch).toBe("feat-x");
  });

  test("both dry-run flags leading", () => {
    expect(parseFinalizeArgs(["--dry-run", "--prune-dry-run", "feat-x"]).branch).toBe("feat-x");
  });

  test("composes with a valued flag", () => {
    const r = parseFinalizeArgs(["--onto", "main", "--prune-dry-run", "feat-x"]);
    expect(r.branch).toBe("feat-x");
    expect(r.onto).toBe("main");
  });

  test("leaves args untouched — runFinalize re-reads them via args.includes()", () => {
    // The flags above are consumed by the parser only to keep them out of
    // the branch slot; their EFFECT is read later from the ORIGINAL args
    // array (`args.includes("--prune-dry-run")` in runFinalize). If parsing
    // ever spliced the array, the Step-6a prune scope would silently stop
    // working while every branch assertion here still passed.
    const args = ["--prune-dry-run", "--onto", "main", "feat-x"];
    parseFinalizeArgs(args);
    expect(args.includes("--prune-dry-run")).toBe(true);
    expect(args).toEqual(["--prune-dry-run", "--onto", "main", "feat-x"]);
  });
});

describe("parseFinalizeArgs — merge strategy + force", () => {
  test("--merge-strategy captures next arg", () => {
    const r = parseFinalizeArgs(["--merge-strategy", "squash"]);
    expect(r.mergeStrategy).toBe("squash");
  });

  test("--force and -f both set the flag", () => {
    expect(parseFinalizeArgs(["--force"]).force).toBe(true);
    expect(parseFinalizeArgs(["-f"]).force).toBe(true);
    expect(parseFinalizeArgs([]).force).toBe(false);
  });
});

describe("giwt finalize --dry-run — legacy flag remedy (CLI surface)", () => {
  // BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the-branch-name:
  // the flag used to land in the branch slot, so the intended remedy was
  // unreachable and the operator saw `no worktree found for branch '--dry-run'`.
  test("leading --dry-run rejects with the remedy, not a bogus branch lookup", () => {
    const r = runFinalize(["--dry-run", "feat-x"]);
    expect(r.out).toContain("--prune-dry-run");
    expect(r.out).not.toContain("no worktree found for branch '--dry-run'");
    expect(r.code).toBe(1);
  });

  test("trailing --dry-run rejects with the same remedy", () => {
    const r = runFinalize(["feat-x", "--dry-run"]);
    expect(r.out).toContain("--prune-dry-run");
    expect(r.out).not.toContain("no worktree found");
    expect(r.code).toBe(1);
  });
});
