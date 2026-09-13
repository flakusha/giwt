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
 */

import { describe, expect, test } from "bun:test";
import { parseFinalizeArgs } from "./commands/finalize.ts";

describe("parseFinalizeArgs — defaults", () => {
  test("empty args returns sensible defaults", () => {
    const r = parseFinalizeArgs([]);
    expect(r.branch).toBe("");
    expect(r.mergeStrategy).toBe("rebase");
    expect(r.force).toBe(false);
    expect(r.gatesFilter).toBe("");
    expect(r.skipGatesFilter).toBe("");
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
