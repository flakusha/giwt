// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for check-links --fix (FEAT-plan-check-links-fix): renamed-file
 * relinks, orphan TASK ref repair, idempotence, and ambiguity refusal.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyLinkFixes } from "./fix";

const tempRoots: string[] = [];
afterEach(() => {
  for (const r of tempRoots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function fixture(): string {
  const root = join("/tmp", `giwt-fix-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(root, ".plan", "tickets"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  tempRoots.push(root);
  return root;
}

const SCAN_DIRS = ["docs", ".plan"];

describe("applyLinkFixes", () => {
  it("relinks a broken link to the renamed file's new location", () => {
    const root = fixture();
    mkdirSync(join(root, "docs", "deep"), { recursive: true });
    writeFileSync(
      join(root, "docs", "guide.md"),
      "see [old](./renamed.md) and [ref][r]\n\n[r]: ./renamed.md\n",
    );
    // The target moved: it now lives in docs/deep/, not next to guide.md.
    writeFileSync(join(root, "docs", "deep", "renamed.md"), "# Renamed\n");

    const res = applyLinkFixes(root, SCAN_DIRS, join(".plan", "tickets"), "src");
    expect(res.fixed.length).toBe(2);
    const text = readFileSync(join(root, "docs", "guide.md"), "utf8");
    expect(text).toBe("see [old](./deep/renamed.md) and [ref][r]\n\n[r]: ./deep/renamed.md\n");
  });

  it("repairs an orphan TASK ref to the canonical ticket id", () => {
    const root = fixture();
    writeFileSync(join(root, ".plan", "tickets", "task-add-trace-fatal.md"), "# FEAT: add trace\n");
    const epic = join(root, ".plan", "epics.md");
    writeFileSync(epic, "| TASK-add-trace | open |\n");

    const res = applyLinkFixes(root, [".plan"], join(".plan", "tickets"), "src");
    expect(res.fixed).toContainEqual({
      file: epic,
      kind: "task-ref",
      from: "TASK-add-trace",
      to: "TASK-add-trace-fatal",
    });
    expect(readFileSync(epic, "utf8")).toBe("| TASK-add-trace-fatal | open |\n");
  });

  it("does not rewrite a ref that is a prefix of a longer existing ref", () => {
    const root = fixture();
    // Only `task-add-trace-fatal` exists; a bare `TASK-add-trace` ref is a
    // legitimate prefix match — repaired to the full id, never truncated.
    writeFileSync(join(root, ".plan", "tickets", "task-add-trace-fatal.md"), "# FEAT\n");
    writeFileSync(join(root, ".plan", "tickets", "task-add-trace-fatal-extra.md"), "# FEAT\n");
    const doc = join(root, ".plan", "doc.md");
    writeFileSync(doc, "TASK-add-trace-fatal and TASK-add-trace\n");

    const res = applyLinkFixes(root, [".plan"], join(".plan", "tickets"), "src");
    // TASK-add-trace-fatal resolves as a prefix of -extra too... ambiguity
    // between the two exact files must NOT corrupt the longer ref.
    const text = readFileSync(doc, "utf8");
    expect(text).toContain("TASK-add-trace-fatal and");
    void res;
  });

  it("is idempotent: a second run rewrites nothing", () => {
    const root = fixture();
    mkdirSync(join(root, "docs", "sub"), { recursive: true });
    // gone.md moved into docs/sub/; the old ./gone.md link is broken.
    writeFileSync(join(root, "docs", "sub", "gone.md"), "# G\n");
    const doc = join(root, "docs", "a.md");
    writeFileSync(doc, "[x](./gone.md)\n");

    const first = applyLinkFixes(root, ["docs"], join(".plan", "tickets"), "src");
    expect(first.fixed.length).toBe(1);
    const after = readFileSync(doc, "utf8");
    expect(after).toBe("[x](./sub/gone.md)\n");
    const second = applyLinkFixes(root, ["docs"], join(".plan", "tickets"), "src");
    expect(second.fixed.length).toBe(0);
    expect(readFileSync(doc, "utf8")).toBe(after);
  });

  it("leaves ambiguous or missing targets untouched and reports them", () => {
    const root = fixture();
    mkdirSync(join(root, "docs", "a"), { recursive: true });
    mkdirSync(join(root, "docs", "b"), { recursive: true });
    // `dup.md` exists twice — no unique basename candidate.
    writeFileSync(join(root, "docs", "a", "dup.md"), "1\n");
    writeFileSync(join(root, "docs", "b", "dup.md"), "2\n");
    const doc = join(root, "docs", "a.md");
    writeFileSync(doc, "[x](./dup.md)\n");

    const res = applyLinkFixes(root, ["docs"], join(".plan", "tickets"), "src");
    expect(res.fixed.length).toBe(0);
    expect(res.unfixableLinks.length).toBe(1);
    expect(readFileSync(doc, "utf8")).toBe("[x](./dup.md)\n");
  });

  it("preserves anchor fragments when relinking", () => {
    const root = fixture();
    mkdirSync(join(root, "docs", "sub"), { recursive: true });
    writeFileSync(join(root, "docs", "sub", "gone.md"), "# Section\n");
    const doc = join(root, "docs", "a.md");
    writeFileSync(doc, "[s](./gone.md#section)\n");

    applyLinkFixes(root, ["docs"], join(".plan", "tickets"), "src");
    expect(readFileSync(doc, "utf8")).toBe("[s](./sub/gone.md#section)\n");
  });
});
