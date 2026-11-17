// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scratchRoot } from "../utils/scratch-tmp";
import { appendIssueRef } from "./sync-md";

const temps: string[] = [];
afterEach(() => {
  while (temps.length > 0) rmSync(temps.pop()!, { recursive: true, force: true });
});

test("appendIssueRef inserts before the --- separator without consuming it", () => {
  const dir = mkdtempSync(join(scratchRoot(), "giwt-issue-ref-"));
  temps.push(dir);
  const path = join(dir, "ticket.md");
  writeFileSync(path, "# TASK: demo\n\n**Status:** Done\n---\n\nbody\n");

  appendIssueRef(path, "abc1234");

  expect(readFileSync(path, "utf8")).toBe(
    "# TASK: demo\n\n**Status:** Done\n\ngit issue: abc1234\n\n---\n\nbody\n",
  );
});

test("appendIssueRef replaces an existing reference in place", () => {
  const dir = mkdtempSync(join(scratchRoot(), "giwt-issue-ref-existing-"));
  temps.push(dir);
  const path = join(dir, "ticket.md");
  writeFileSync(path, "# TASK: demo\n\ngit issue: 7654321\n\nbody\n");

  appendIssueRef(path, "abc1234");

  const out = readFileSync(path, "utf8");
  expect(out).toContain("git issue: abc1234");
  expect(out).not.toContain("7654321");
});
