// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Diff-scope collection for runSync: which plan-file extids actually
 * changed relative to a diff base. Mirrors the per-file gate scoping
 * (ValidateOptions.diffBase) so a sibling worktree's finalize — whose
 * git-issue closes are repo-global — cannot fail THIS tree's sync while
 * its `.plan` copy still shows the tickets open.
 */

import { isolatedGitEnv } from "../utils/git";
import { log } from "../utils/output";
import type { SyncReport } from "./sync-ticket-types";

/** Filename (any case) → extid: stem minus .md, uppercased. Index keys and
 *  filename stems may differ in case, so both sides normalize here. */
function stemExtid(filename: string): string {
  return filename.replace(/\.md$/i, "").toUpperCase();
}

/**
 * Restrict the report to `scope` extids. Mirrors the per-file gate scoping
 * (ValidateOptions.diffBase): foreign tickets from concurrently-active
 * sessions must not gate this branch's sync. Every extid-keyed category is
 * filtered; `foreignUnparsedIssues` carries no extid and stays global, and
 * `unboundEpics`/`fixesApplied` are informational/non-gating.
 */
export function applyReportScope(report: SyncReport, scope: Set<string>): void {
  const keep = (extid: string) => scope.has(extid.toUpperCase());
  const keepRows = <T extends { extid: string; }>(rows: T[]) => rows.filter((r) => keep(r.extid));

  report.orphanFiles = report.orphanFiles.filter((f) => keep(stemExtid(f)));
  report.phantomEntries = report.phantomEntries.filter(keep);
  report.placeholderHashes = keepRows(report.placeholderHashes);
  report.hashMismatches = keepRows(report.hashMismatches);
  report.statusMismatches = keepRows(report.statusMismatches);
  report.missingHashes = keepRows(report.missingHashes);
  report.missingGitIssueLinks = keepRows(report.missingGitIssueLinks);
  report.staleOpenGitIssues = keepRows(report.staleOpenGitIssues);
  report.orphanGitIssues = keepRows(report.orphanGitIssues);
  report.importableTickets = keepRows(report.importableTickets);
  report.foreignIssues = keepRows(report.foreignIssues);
  report.duplicateOpenIssues = keepRows(report.duplicateOpenIssues);
  report.danglingMdRefs = keepRows(report.danglingMdRefs);
  report.titleDrifts = keepRows(report.titleDrifts);
  report.mdStatusStale = keepRows(report.mdStatusStale);
  report.indexStatusStale = keepRows(report.indexStatusStale);
}

/** Returns null on git failure (e.g. unknown ref) so runSync can fail
 *  closed instead of silently widening to a full scan. */
export function scopedPlanExtids(opts: {
  repoRoot: string;
  diffBase: string;
  ticketsPrefix: string;
  epicsPrefix: string;
}): Set<string> | null {
  const { repoRoot, diffBase, ticketsPrefix, epicsPrefix } = opts;
  const extids = new Set<string>();
  const prefixes = [`${ticketsPrefix}/`, `${epicsPrefix}/`];
  const queries: Array<{ args: string[]; what: string; }> = [
    { args: ["diff", "--name-only", diffBase], what: "committed/dirty diff vs base" },
    { args: ["diff", "--name-only", "HEAD"], what: "dirty diff" },
    { args: ["ls-files", "--others", "--exclude-standard"], what: "untracked files" },
  ];

  for (const { args, what } of queries) {
    const result = Bun.spawnSync(["git", "-C", repoRoot, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      // Isolate from ambient GIT_* hook context (see isolatedGitEnv).
      env: isolatedGitEnv(),
    });
    if (result.exitCode !== 0) {
      const detail = result.stderr.toString().trim().split("\n").pop() ?? "";
      log(
        "error",
        `Ticket sync: cannot scope to diff base '${diffBase}' — git ${args.join(" ")} `
          + `(${what}) failed${detail ? `: ${detail}` : ""}.`,
      );
      return null;
    }
    for (const line of result.stdout.toString().split("\n")) {
      const path = line.trim().replace(/\\/g, "/");
      if (!path.endsWith(".md")) continue;
      if (!prefixes.some((p) => path.startsWith(p))) continue;
      const base = path.slice(path.lastIndexOf("/") + 1);
      extids.add(base.replace(/\.md$/i, "").toUpperCase());
    }
  }
  return extids;
}
