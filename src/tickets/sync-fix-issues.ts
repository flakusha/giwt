// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Registry-touching fix passes for the ticket-index sync: issue import
 * (`--import`), title-drift rename, import-back (`--import-back`), and
 * stale-open issue close. Call order is owned by `applyFixes`
 * (sync-fixes.ts).
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isolatedGitEnv } from "../utils/git";
import type { FixContext } from "./sync-fixes";
import { appendIssueRef } from "./sync-md";
import { normalizeStatus } from "./sync-normalize";
import { vocabStatusTarget } from "./sync-parse";
import type { IndexEntry, SyncReport, TicketFile } from "./sync-ticket-types";
import { sanitizeTicketBody } from "./ticket-md";

/** Import: create registry issues for plan files that have none. Unlike
 * the placeholder fix (which deliberately never mass-creates for
 * unprovenanced index entries), an existing .md file IS provenance —
 * one bounded create per file, idempotent by extid. Opt-in (`--import`):
 * plain --fix only reports importable tickets, never mass-creates. */
export function importTickets(
  fixed: Record<string, IndexEntry>,
  report: SyncReport,
  fileByExtid: Map<string, TicketFile>,
  ctx: FixContext,
): void {
  for (const it of report.importableTickets) {
    const tf = fileByExtid.get(it.extid);
    if (!tf) continue;
    try {
      const out = execFileSync(
        "git",
        ["issue", "create", `${it.extid}: ${it.title}`, "-m", `Imported from ${it.source}`],
        { timeout: 10_000, cwd: ctx.repoRoot, env: isolatedGitEnv(), encoding: "utf8" },
      );
      const created = out.match(/Created issue ([0-9a-f]{7,40})/);
      if (!created?.[1]) throw new Error(`unparsable create output: ${out.slice(0, 80)}`);
      const hash = created[1].slice(0, 7);

      const entry = fixed[it.extid];
      fixed[it.extid] = {
        ...(entry ?? {}),
        hash,
        git_issue: hash,
        extid: it.extid,
        type: tf.type,
        title: tf.title,
        label: tf.type.toLowerCase(),
        priority: tf.priority,
        epic: tf.epic,
        tags: tf.tags,
        source: it.source,
        status: entry?.status ?? normalizeStatus(tf.status),
      } as IndexEntry;

      appendIssueRef(tf.path, hash);
      report.fixesApplied.push(
        `${it.extid}: imported ${it.source} → git issue ${hash}`,
      );
    } catch (e) {
      report.fixesApplied.push(
        `${it.extid}: FAILED to import ${it.source}: ${
          e instanceof Error ? e.message.split("\n")[0] : String(e)
        }`,
      );
    }
  }
}

/** Title drift: the ticket was reclassified/moved (TASK-x → BUG-x); rename
 * the registry issue to match and relink file + index to it. */
export function fixTitleDrifts(
  fixed: Record<string, IndexEntry>,
  report: SyncReport,
  fileByExtid: Map<string, TicketFile>,
  ctx: FixContext,
): void {
  for (const td of report.titleDrifts) {
    try {
      const strippedTitle = td.issueTitle.replace(/^\S+[:-]?\s*/, "");
      execFileSync(
        "git",
        ["issue", "edit", td.hash, "-t", `${td.extid}: ${strippedTitle}`],
        { timeout: 10_000, cwd: ctx.repoRoot, env: isolatedGitEnv(), encoding: "utf8" },
      );
      const entry = fixed[td.extid];
      if (entry) {
        fixed[td.extid] = { ...entry, hash: td.hash, git_issue: td.hash };
      }
      const tf = fileByExtid.get(td.extid);
      if (tf) appendIssueRef(tf.path, td.hash);
      report.fixesApplied.push(
        `${td.extid}: renamed issue ${td.hash} (${td.issueExtid} → ${td.extid})`,
      );
    } catch (e) {
      report.fixesApplied.push(
        `${td.extid}: FAILED to rename issue ${td.hash}: ${
          e instanceof Error ? e.message.split("\n")[0] : String(e)
        }`,
      );
    }
  }
}

/** Import-back: generate .md + index entry for foreign registry issues.
 * Explicit opt-in (`--import-back`) — this can resurrect deliberately
 * deleted tickets, so it never runs as part of plain --fix. */
export function importBackIssues(
  fixed: Record<string, IndexEntry>,
  report: SyncReport,
  ctx: FixContext,
): void {
  for (const fi of report.foreignIssues) {
    try {
      const type = /^([A-Z]+)-/.exec(fi.extid)?.[1] ?? "TASK";
      const bareTitle = fi.title.replace(/^\S+[:]\s*/, "");
      const filename = `${fi.extid}.md`;
      const target = join(ctx.ticketsDir, filename);
      // Never clobber an existing plan file in the target dir — or in the
      // canonical .plan/tickets location when syncing a custom dir.
      const canonical = join(resolve(ctx.repoRoot, ".plan/tickets"), filename);
      if (existsSync(target) || (canonical !== target && existsSync(canonical))) {
        report.fixesApplied.push(
          `${fi.extid}: SKIPPED import-back — ${filename} already exists`,
        );
        continue;
      }
      // Import-back is a ticket generator too: its .md must pass the repo
      // markdownlint gate unchanged, so the embedded lines flow through the
      // shared sanitizer and the file ends with exactly one newline.
      const body = sanitizeTicketBody(
        `Imported from git issue ${fi.hash}.\n\ngit issue: ${fi.hash}`,
      );
      writeFileSync(
        target,
        `# ${type}: ${bareTitle}\n\n**Status:** ${
          vocabStatusTarget("open")
        }\n**Priority:** medium\n\n${body}\n`,
      );
      fixed[fi.extid] = {
        hash: fi.hash,
        git_issue: fi.hash,
        extid: fi.extid,
        type,
        title: bareTitle,
        label: type.toLowerCase(),
        priority: "medium",
        epic: "",
        tags: [],
        source: `${ctx.ticketsPrefix}/${filename}`,
        status: "open",
      };
      report.fixesApplied.push(
        `${fi.extid}: imported back git issue ${fi.hash} → ${ctx.ticketsPrefix}/${filename}`,
      );
    } catch (e) {
      report.fixesApplied.push(
        `${fi.extid}: FAILED import-back: ${
          e instanceof Error ? e.message.split("\n")[0] : String(e)
        }`,
      );
    }
  }
}

/** Close stale open git issues (index=done, git=open). */
export function closeStaleOpenIssues(
  report: SyncReport,
  repoRoot: string,
): void {
  for (const m of report.staleOpenGitIssues) {
    try {
      execSync(
        `git issue state ${m.gitIssueHash} --close -m 'Auto-closed: ticket ${m.extid} marked done in index.json'`,
        { timeout: 10_000, cwd: repoRoot, env: isolatedGitEnv() },
      );
      report.fixesApplied.push(`${m.extid}: closed git issue ${m.gitIssueHash}`);
    } catch {
      report.fixesApplied.push(`${m.extid}: FAILED to close git issue ${m.gitIssueHash}`);
    }
  }
}
