// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scratchRoot } from "../utils/scratch-tmp";
import { closeStaleOpenIssues } from "./sync-fix-issues";
import { fixMdStatusStale, fixStatusMismatches } from "./sync-fix-status";
import type { IndexEntry, SyncReport, TicketFile } from "./sync-ticket-types";

const temps: string[] = [];
afterEach(() => {
  while (temps.length > 0) rmSync(temps.pop()!, { recursive: true, force: true });
});

function emptyReport(): SyncReport {
  return {
    orphanFiles: [],
    phantomEntries: [],
    placeholderHashes: [],
    hashMismatches: [],
    statusMismatches: [],
    missingHashes: [],
    missingGitIssueLinks: [],
    staleOpenGitIssues: [],
    orphanGitIssues: [],
    importableTickets: [],
    foreignIssues: [],
    foreignUnparsedIssues: [],
    duplicateOpenIssues: [],
    danglingMdRefs: [],
    titleDrifts: [],
    mdStatusStale: [],
    indexStatusStale: [],
    unboundEpics: [],
    fixesApplied: [],
  };
}

function ticketFile(path: string, status: string): TicketFile {
  return {
    path,
    filename: "TASK-DECORATED.md",
    title: "decorated status",
    status,
    statusValues: [status],
    type: "TASK",
    priority: "medium",
    epic: "",
    project: "",
    tags: [],
    upstream: "",
    hash: "1234567",
    gitIssue: "1234567",
    source: path,
  };
}

function entry(): IndexEntry {
  return {
    hash: "1234567",
    extid: "TASK-DECORATED",
    type: "TASK",
    title: "decorated status",
    label: "task",
    priority: "medium",
    epic: "",
    project: "",
    tags: [],
    source: ".plan/tickets/TASK-DECORATED.md",
  };
}

test("md-status fixer rewrites list-decorated Status lines, preserving the prefix", () => {
  const dir = mkdtempSync(join(scratchRoot(), "giwt-status-md-"));
  temps.push(dir);
  const path = join(dir, "ticket.md");
  writeFileSync(path, "# TASK: demo\n\n- **Status:** Not Started\n");
  const report = emptyReport();
  report.mdStatusStale.push({
    extid: "TASK-DECORATED",
    mdStatus: "Not Started",
    indexStatus: "done",
    source: path,
  });
  fixMdStatusStale(
    { "TASK-DECORATED": entry() },
    report,
    new Map([["TASK-DECORATED", ticketFile(path, "Not Started")]]),
    dir,
  );
  expect(readFileSync(path, "utf8")).toContain("- **Status:** Done");
});

test("git-status fixer rewrites quote-decorated Status lines, preserving the prefix", () => {
  const dir = mkdtempSync(join(scratchRoot(), "giwt-status-git-"));
  temps.push(dir);
  const path = join(dir, "ticket.md");
  writeFileSync(path, "# TASK: demo\n\n> **Status**: In Progress\n");
  const report = emptyReport();
  report.statusMismatches.push({
    extid: "TASK-DECORATED",
    indexStatus: "open",
    gitStatus: "done",
  });
  fixStatusMismatches(
    { "TASK-DECORATED": entry() },
    report,
    new Map([["TASK-DECORATED", ticketFile(path, "In Progress")]]),
    dir,
  );
  expect(readFileSync(path, "utf8")).toContain("> **Status**: Done");
});

test("auto-close passes the extid message as one argv element, never through a shell", () => {
  const dir = mkdtempSync(join(scratchRoot(), "giwt-close-argv-"));
  temps.push(dir);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const shim = join(bin, "git");
  writeFileSync(
    shim,
    "#!/bin/sh\nprintf '%s\\0' \"$@\" >> \"$SHIM_LOG\"\nexit 0\n",
  );
  chmodSync(shim, 0o755);
  const log = join(dir, "argv.log");
  const oldPath = process.env.PATH;
  const oldLog = process.env.SHIM_LOG;
  process.env.PATH = `${bin}:${oldPath ?? ""}`;
  process.env.SHIM_LOG = log;
  try {
    const extid = "TASK-X'; echo INJECTED-COMMAND; #";
    const report = emptyReport();
    report.staleOpenGitIssues.push({ extid, gitIssueHash: "1234567", indexStatus: "done" });
    closeStaleOpenIssues(report, dir);
    const argv = readFileSync(log).toString().split("\0").filter(Boolean);
    expect(argv).toContain(`Auto-closed: ticket ${extid} marked done in index.json`);
    expect(argv).not.toContain("INJECTED-COMMAND");
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    if (oldLog === undefined) delete process.env.SHIM_LOG;
    else process.env.SHIM_LOG = oldLog;
  }
});

/** Header with multiple Status lines (bold value, appended done-marker), a
 * fenced reproduction example, and a Status past the 30-line header the
 * parser never reads. */
function wideTicketText(): string {
  const lines = [
    "# BUG: demo",
    "",
    "**Status:** Not Started",
    "> **Status**: duplicate-of-OLD",
    "**Status:** **In Progress**",
    "",
    "```md",
    "**Status:** In Progress",
    "```",
  ];
  while (lines.length < 31) lines.push("filler");
  lines.push("**Status:** In Progress", "body");
  return lines.join("\n");
}

test("md-status fixer rewrites only parsed header Status lines", () => {
  const dir = mkdtempSync(join(scratchRoot(), "giwt-status-bounds-md-"));
  temps.push(dir);
  const path = join(dir, "ticket.md");
  writeFileSync(path, wideTicketText());
  const report = emptyReport();
  report.mdStatusStale.push({
    extid: "TASK-DECORATED",
    mdStatus: "Not Started",
    indexStatus: "done",
    source: path,
  });
  fixMdStatusStale(
    { "TASK-DECORATED": entry() },
    report,
    new Map([["TASK-DECORATED", ticketFile(path, "Not Started")]]),
    dir,
  );
  const out = readFileSync(path, "utf8");
  expect(out).toContain("**Status:** Done\n");
  expect(out).toContain("> **Status**: Done\n");
  expect(out).toContain("**Status:** **Done**\n");
  // fenced example and the line past the header are outside the parser region
  expect(out).toContain("```md\n**Status:** In Progress\n```");
  expect(out).toContain("filler\n**Status:** In Progress\nbody");
});

test("git-status fixer rewrites only parsed header Status lines", () => {
  const dir = mkdtempSync(join(scratchRoot(), "giwt-status-bounds-git-"));
  temps.push(dir);
  const path = join(dir, "ticket.md");
  writeFileSync(path, wideTicketText());
  const report = emptyReport();
  report.statusMismatches.push({
    extid: "TASK-DECORATED",
    indexStatus: "open",
    gitStatus: "done",
  });
  fixStatusMismatches(
    { "TASK-DECORATED": entry() },
    report,
    new Map([["TASK-DECORATED", ticketFile(path, "Not Started")]]),
    dir,
  );
  const out = readFileSync(path, "utf8");
  expect(out).toContain("**Status:** Done\n");
  expect(out).toContain("> **Status**: Done\n");
  expect(out).toContain("**Status:** **Done**\n");
  expect(out).toContain("```md\n**Status:** In Progress\n```");
  expect(out).toContain("filler\n**Status:** In Progress\nbody");
});
