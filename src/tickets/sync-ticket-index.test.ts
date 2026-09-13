// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for src/tickets/sync-ticket.ts — pure reconciliation logic for
 * .plan/tickets/index.json. Covers gitObjectExists, normalizeStatus, and
 * reconcile's phantom/hash/orphan classification.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type GitIssue,
  gitObjectExists,
  type IndexEntry,
  normalizeStatus,
  reconcile,
} from "./sync-ticket";

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "sync-ticket-"));
  mkdirSync(join(root, ".plan/tickets"), { recursive: true });
  mkdirSync(join(root, ".plan/epics"), { recursive: true });
  return root;
}

function entry(overrides: Partial<IndexEntry>): IndexEntry {
  return {
    hash: "pending",
    extid: "TASK-X",
    type: "TASK",
    title: "Some task",
    label: "task",
    priority: "medium",
    epic: "",
    tags: [],
    source: "",
    ...overrides,
  };
}

// ── gitObjectExists ────────────────────────────────────────────

describe("gitObjectExists", () => {
  test("false for placeholder/non-hex junk", () => {
    expect(gitObjectExists("123456789")).toBe(false);
    expect(gitObjectExists("zzzzzzz")).toBe(false);
    expect(gitObjectExists("")).toBe(false);
  });

  test("true for a real commit hash", async () => {
    // HEAD always resolves in this repo; its short hash is a valid commit.
    const realHash = (await Bun.$`git rev-parse --short HEAD`.text()).trim();
    expect(gitObjectExists(realHash)).toBe(true);
    // A plausible-length all-hex string that is not a real object is false.
    expect(gitObjectExists("abcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabca")).toBe(
      false,
    );
  });
});

// ── normalizeStatus ────────────────────────────────────────────

describe("normalizeStatus", () => {
  test("maps done/closed/complete synonyms", () => {
    expect(normalizeStatus("Done")).toBe("done");
    expect(normalizeStatus("✅ Complete")).toBe("done");
    expect(normalizeStatus("closed")).toBe("done");
  });

  test("maps progress/open/draft", () => {
    expect(normalizeStatus("In Progress")).toBe("in_progress");
    expect(normalizeStatus("open")).toBe("open");
    expect(normalizeStatus("Draft")).toBe("draft");
  });

  test("passes unknown through unchanged", () => {
    expect(normalizeStatus("Weird")).toBe("Weird");
  });
});

// ── reconcile: orphan files ────────────────────────────────────

describe("reconcile orphan detection", () => {
  test("flags ticket file absent from index", () => {
    const ticketFiles = [{
      path: "x",
      filename: "TASK-NEW.md",
      title: "New",
      status: "open",
      type: "TASK",
      priority: "medium",
      epic: "",
      hash: null,
      gitIssue: null,
    }];
    const root = makeRoot();
    const report = reconcile(ticketFiles, new Map(), {}, false, root);
    expect(report.orphanFiles).toEqual(["TASK-NEW.md"]);
  });
});

// ── reconcile: phantom entries ─────────────────────────────────

describe("reconcile phantom detection", () => {
  test("entry with existing ticket source is not phantom", () => {
    const root = makeRoot();
    writeFileSync(join(root, ".plan/tickets/TASK-EXISTS.md"), "# TASK-EXISTS\n");
    const report = reconcile(
      [],
      new Map(),
      { "TASK-EXISTS": entry({ source: ".plan/tickets/TASK-EXISTS.md" }) },
      false,
      root,
    );
    expect(report.phantomEntries).toEqual([]);
  });

  test("entry with existing epics source is not phantom (no re-anchor)", () => {
    const root = makeRoot();
    writeFileSync(join(root, ".plan/epics/epic-housing.md"), "# Epic Housing\n");
    const report = reconcile(
      [],
      new Map(),
      { "EPIC-HOUSING": entry({ extid: "EPIC-HOUSING", source: ".plan/epics/epic-housing.md" }) },
      false,
      root,
    );
    expect(report.phantomEntries).toEqual([]);
  });

  test("entry with missing source is phantom", () => {
    const root = makeRoot();
    const report = reconcile(
      [],
      new Map(),
      { "TASK-GONE": entry({ source: ".plan/tickets/TASK-GONE.md" }) },
      false,
      root,
    );
    expect(report.phantomEntries).toEqual(["TASK-GONE"]);
  });
});

// ── reconcile: hash provenance ─────────────────────────────────

describe("reconcile hash provenance", () => {
  test("valid commitHash is accepted, not placeholder/mismatch", () => {
    const report = reconcile(
      [],
      new Map(),
      { "TASK-SHIPPED": entry({ hash: "pending", commitHash: "9aefe593" }) },
      false,
      makeRoot(),
    );
    expect(report.placeholderHashes).toEqual([]);
    expect(report.hashMismatches).toEqual([]);
  });

  test("placeholder hash (no git issue, not a commit) is advisory", () => {
    const report = reconcile(
      [],
      new Map(),
      { "TASK-IM": entry({ hash: "123456789" }) },
      false,
      makeRoot(),
    );
    expect(report.placeholderHashes).toEqual([
      { extid: "TASK-IM", indexHash: "123456789", ticketTitle: "Some task" },
    ]);
    expect(report.hashMismatches).toEqual([]);
  });

  test("issue hash with matching title is clean", () => {
    const issues = new Map<string, GitIssue>();
    issues.set("abc1234", {
      hash: "abc1234",
      status: "open",
      title: "TASK-000: Some Task",
      extid: "TASK-000",
    });
    const report = reconcile(
      [],
      issues,
      { "TASK-000": entry({ hash: "abc1234", title: "Some Task" }) },
      false,
      makeRoot(),
    );
    expect(report.hashMismatches).toEqual([]);
    expect(report.placeholderHashes).toEqual([]);
  });

  test("issue hash with mismatched title is a hard mismatch", () => {
    const issues = new Map<string, GitIssue>();
    issues.set("abc1234", {
      hash: "abc1234",
      status: "open",
      title: "TASK-999: Something Else Entirely",
      extid: "TASK-999",
    });
    const report = reconcile(
      [],
      issues,
      { "TASK-000": entry({ hash: "abc1234", title: "Completely Unrelated Title" }) },
      false,
      makeRoot(),
    );
    expect(report.hashMismatches.length).toBeGreaterThan(0);
    expect(report.hashMismatches[0]?.extid).toBe("TASK-000");
  });

  test("pending hash is skipped entirely", () => {
    const report = reconcile(
      [],
      new Map(),
      { "TASK-P": entry({ hash: "pending" }) },
      false,
      makeRoot(),
    );
    expect(report.placeholderHashes).toEqual([]);
    expect(report.hashMismatches).toEqual([]);
  });
});

// ── reconcile: missing git_issue links ─────────────────────────

describe("reconcile missing git_issue links", () => {
  test("entry without git_issue but matching issue by extid is flagged", () => {
    const issues = new Map<string, GitIssue>();
    issues.set("aaa1111", {
      hash: "aaa1111",
      status: "open",
      title: "TASK-LINKED: Linked Task",
      extid: "TASK-LINKED",
    });
    const report = reconcile(
      [],
      issues,
      { "TASK-LINKED": entry({ hash: "bbb2222", extid: "TASK-LINKED" }) },
      false,
      makeRoot(),
    );
    expect(report.missingGitIssueLinks).toEqual([
      {
        extid: "TASK-LINKED",
        suggestedGitIssue: "aaa1111",
        gitTitle: "TASK-LINKED: Linked Task",
      },
    ]);
  });

  test("entry with existing git_issue is not flagged", () => {
    const issues = new Map<string, GitIssue>();
    issues.set("aaa1111", {
      hash: "aaa1111",
      status: "open",
      title: "TASK-LINKED: Linked Task",
      extid: "TASK-LINKED",
    });
    const report = reconcile(
      [],
      issues,
      { "TASK-LINKED": entry({ hash: "bbb2222", git_issue: "aaa1111", extid: "TASK-LINKED" }) },
      false,
      makeRoot(),
    );
    expect(report.missingGitIssueLinks).toEqual([]);
  });
});

// ── reconcile: stale open git issues ───────────────────────────

describe("reconcile stale open git issues", () => {
  test("done entry with open git issue is flagged", () => {
    const issues = new Map<string, GitIssue>();
    issues.set("ccc3333", {
      hash: "ccc3333",
      status: "open",
      title: "TASK-STALE: Stale Task",
      extid: "TASK-STALE",
    });
    const report = reconcile(
      [],
      issues,
      { "TASK-STALE": entry({ git_issue: "ccc3333", status: "done", extid: "TASK-STALE" }) },
      false,
      makeRoot(),
    );
    expect(report.staleOpenGitIssues).toEqual([
      {
        extid: "TASK-STALE",
        gitIssueHash: "ccc3333",
        indexStatus: "done",
      },
    ]);
  });

  test("done entry with closed git issue is not flagged", () => {
    const issues = new Map<string, GitIssue>();
    issues.set("ccc3333", {
      hash: "ccc3333",
      status: "closed",
      title: "TASK-STALE: Stale Task",
      extid: "TASK-STALE",
    });
    const report = reconcile(
      [],
      issues,
      { "TASK-STALE": entry({ git_issue: "ccc3333", status: "done", extid: "TASK-STALE" }) },
      false,
      makeRoot(),
    );
    expect(report.staleOpenGitIssues).toEqual([]);
  });

  test("open entry with open git issue is not flagged", () => {
    const issues = new Map<string, GitIssue>();
    issues.set("ccc3333", {
      hash: "ccc3333",
      status: "open",
      title: "TASK-ACTIVE: Active Task",
      extid: "TASK-ACTIVE",
    });
    const report = reconcile(
      [],
      issues,
      { "TASK-ACTIVE": entry({ git_issue: "ccc3333", status: "open", extid: "TASK-ACTIVE" }) },
      false,
      makeRoot(),
    );
    expect(report.staleOpenGitIssues).toEqual([]);
  });
});

// ── reconcile: orphan git issues ───────────────────────────────

describe("reconcile orphan git issues", () => {
  test("open issue with no matching index entry is orphan", () => {
    const issues = new Map<string, GitIssue>();
    issues.set("ddd4444", {
      hash: "ddd4444",
      status: "open",
      title: "TASK-ORPHAN: Orphan Issue",
      extid: "TASK-ORPHAN",
    });
    const report = reconcile(
      [],
      issues,
      {}, // empty index
      false,
      makeRoot(),
    );
    expect(report.orphanGitIssues).toEqual([
      {
        hash: "ddd4444",
        extid: "TASK-ORPHAN",
        title: "TASK-ORPHAN: Orphan Issue",
      },
    ]);
  });

  test("open issue with matching index entry is not orphan", () => {
    const issues = new Map<string, GitIssue>();
    issues.set("ddd4444", {
      hash: "ddd4444",
      status: "open",
      title: "TASK-EXISTS: Existing Task",
      extid: "TASK-EXISTS",
    });
    const report = reconcile(
      [],
      issues,
      { "TASK-EXISTS": entry({ extid: "TASK-EXISTS" }) },
      false,
      makeRoot(),
    );
    expect(report.orphanGitIssues).toEqual([]);
  });

  test("closed issue with no index entry is not orphan", () => {
    const issues = new Map<string, GitIssue>();
    issues.set("ddd4444", {
      hash: "ddd4444",
      status: "closed",
      title: "TASK-CLOSED: Closed Issue",
      extid: "TASK-CLOSED",
    });
    const report = reconcile(
      [],
      issues,
      {},
      false,
      makeRoot(),
    );
    expect(report.orphanGitIssues).toEqual([]);
  });

  test("open issue without extid is not orphan", () => {
    const issues = new Map<string, GitIssue>();
    issues.set("ddd4444", {
      hash: "ddd4444",
      status: "open",
      title: "Some random idea without prefix",
      extid: null,
    });
    const report = reconcile(
      [],
      issues,
      {},
      false,
      makeRoot(),
    );
    expect(report.orphanGitIssues).toEqual([]);
  });
});
