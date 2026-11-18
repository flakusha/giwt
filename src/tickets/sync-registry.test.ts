// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Regression coverage for the registry readers (src/tickets/sync-registry.ts).
 *
 * `git issue ls` is replaced by a deterministic `git` shim via PATH so custom
 * states and every accepted extid prefix are exercised without mutating a
 * real issue registry (or any git config).
 */

import { afterEach, expect, spyOn, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scratchRoot } from "../utils/scratch-tmp";
import { runSync } from "./sync-index";
import { parseTicketExtid, readGitIssues, readIndex } from "./sync-registry";

const temps: string[] = [];
afterEach(() => {
  while (temps.length > 0) rmSync(temps.pop()!, { recursive: true, force: true });
});

/** Run `body` with `git` resolving to a shim executing `script`. */
function withGitShim(script: string, body: () => void): void {
  const dir = mkdtempSync(join(scratchRoot(), "giwt-registry-shim-"));
  temps.push(dir);
  const shim = join(dir, "git");
  writeFileSync(shim, `#!/bin/sh\n${script}\n`);
  chmodSync(shim, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = oldPath === undefined ? dir : `${dir}:${oldPath}`;
  try {
    body();
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
  }
}

/** Run `body` with `git` resolving to a shim that prints exactly `lines`. */
function withIssueLines(lines: string[], body: () => void): void {
  withGitShim(`cat <<'GIWT_EOF'\n${lines.join("\n")}\nGIWT_EOF`, body);
}

test("readGitIssues retains custom issue states and classifies them as open", () => {
  withIssueLines(
    [
      "aaaaaaa open TASK-001: open one",
      "bbbbbbb closed TASK-002: closed one",
      "ccccccc done TASK-003: done one",
      "ddddddd in-progress TASK-004: custom state one",
      "eeeeeee blocked TASK-005: custom state two",
    ],
    () => {
      const { issues, available } = readGitIssues(scratchRoot(), 1000);
      expect(available).toBe(true);
      expect([...issues.keys()]).toEqual([
        "aaaaaaa",
        "bbbbbbb",
        "ccccccc",
        "ddddddd",
        "eeeeeee",
      ]);
      expect(issues.get("aaaaaaa")?.status).toBe("open");
      expect(issues.get("bbbbbbb")?.status).toBe("closed");

      expect(issues.get("ccccccc")?.status).toBe("done");
      // Custom states (set via `git issue state --state …`) must not vanish.
      expect(issues.get("ddddddd")?.status).toBe("open");
      expect(issues.get("eeeeeee")?.status).toBe("open");
    },
  );
});

test("parseTicketExtid accepts both title forms case-insensitively", () => {
  expect(parseTicketExtid("TASK-demo: colon form")).toBe("TASK-demo");
  expect(parseTicketExtid("BUG-bare registry form")).toBe("BUG-bare");
  expect(parseTicketExtid("feat-lower: lower-case prefix")).toBe("feat-lower");
  expect(parseTicketExtid("no extid prefix here")).toBeNull();
  expect(parseTicketExtid("null: packet loss")).toBeNull();
});

test("readGitIssues parses colonless and lower-case titles into extids", () => {
  withIssueLines(
    [
      "aaaaaaa open TASK-006 bare registry title",
      "bbbbbbb open feat-lower: lower-case title",
      "ccccccc open null: packet loss",
    ],
    () => {
      const { issues, available } = readGitIssues(scratchRoot(), 1000);
      expect(available).toBe(true);
      expect(issues.get("aaaaaaa")?.extid).toBe("TASK-006");
      expect(issues.get("bbbbbbb")?.extid).toBe("FEAT-LOWER");
      expect(issues.get("ccccccc")?.extid).toBeNull();
    },
  );
});

test("readGitIssues classifies a missing git binary as missing", () => {
  const dir = mkdtempSync(join(scratchRoot(), "giwt-registry-empty-path-"));
  temps.push(dir);
  const oldPath = process.env.PATH;
  process.env.PATH = dir;
  try {
    const result = readGitIssues(scratchRoot(), 1000);
    expect(result.available).toBe(false);
    expect(result.reason).toBe("missing");
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
  }
});

test("readGitIssues classifies an uninstalled git-issue subcommand", () => {
  withGitShim("echo \"git: 'issue' is not a git command. See 'git --help'.\" >&2; exit 1", () => {
    const result = readGitIssues(scratchRoot(), 1000);
    expect(result.available).toBe(false);
    expect(result.reason).toBe("missing-issue-cli");
  });
});

test("readGitIssues reports exit detail for a failed listing", () => {
  withGitShim("echo 'registry corrupt' >&2; exit 1", () => {
    const result = readGitIssues(scratchRoot(), 1000);
    expect(result.available).toBe(false);
    expect(result.reason).toBe("failed");
    expect(result.detail).toContain("exit 1");
    expect(result.detail).toContain("registry corrupt");
  });
  withGitShim("exit 1", () => {
    const result = readGitIssues(scratchRoot(), 1000);
    expect(result.reason).toBe("failed");
    expect(result.detail).toBe("exit 1");
  });
});

test("readGitIssues parses extids from the scanner and ticket-creation prefix sets", () => {
  withIssueLines(
    [
      "1111111 open IDEA-101: idea ticket",
      "2222222 open TEST-102: test ticket",
      "3333333 open PERF-103: perf ticket",
      "4444444 open WIRE-104: wire ticket",
      "5555555 open IMPROVE-105: improve ticket",
      "6666666 open EPIC-106: epic ticket",
      "7777777 open TASK-107: task ticket",
    ],
    () => {
      const { issues } = readGitIssues(scratchRoot(), 1000);
      expect([...issues.values()].map((issue) => issue.extid)).toEqual([
        "IDEA-101",
        "TEST-102",
        "PERF-103",
        "WIRE-104",
        "IMPROVE-105",
        "EPIC-106",
        "TASK-107",
      ]);
    },
  );
});

test("readIndex throws with the path on unparseable JSON", () => {
  const dir = mkdtempSync(join(scratchRoot(), "giwt-registry-index-"));
  temps.push(dir);
  const indexPath = join(dir, "index.json");
  writeFileSync(indexPath, "{\"TASK-PHANTOM\":");
  expect(() => readIndex(indexPath)).toThrow(`${indexPath}: invalid JSON`);
});

test("readIndex still degrades a missing index to empty", () => {
  const dir = mkdtempSync(join(scratchRoot(), "giwt-registry-missing-"));
  temps.push(dir);
  expect(readIndex(join(dir, "index.json"))).toEqual({});
});

test("runSync rejects a corrupt index instead of regenerating it from .md files", () => {
  const dir = mkdtempSync(join(scratchRoot(), "giwt-registry-sync-"));
  temps.push(dir);
  const tickets = join(dir, ".plan/tickets");
  mkdirSync(tickets, { recursive: true });
  writeFileSync(join(tickets, "TASK-PHANTOM.md"), "# TASK: phantom\n\nStatus: done\n");
  const indexPath = join(tickets, "index.json");
  // Phantom entry: present in the index, not recreatable from any .md file.
  const corrupt = "{\"TASK-PHANTOM\":{\"hash\":\"abc1234\"";
  writeFileSync(indexPath, corrupt);

  const chunks: string[] = [];
  const push = (chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  };
  const outSpy = spyOn(process.stdout, "write").mockImplementation(push as never);
  const errSpy = spyOn(process.stderr, "write").mockImplementation(push as never);
  try {
    expect(() => runSync(dir)).toThrow(/invalid JSON/);
    expect(() => runSync(dir, { fix: true })).toThrow(/invalid JSON/);
    expect(readFileSync(indexPath, "utf8")).toBe(corrupt);
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
});
