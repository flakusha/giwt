// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Sync .plan/tickets/index.json with ticket .md files and git issues.
 *
 * Reads:
 *   1. .plan/tickets/*.md — extract frontmatter (title, status, type, priority, epic)
 *   2. git issue ls — build hash→issue lookup
 *   3. .plan/tickets/index.json — current index state
 *
 * Reports:
 *   - Orphan files (.md exists, not in index)
 *   - Phantom entries (index has entry, .md missing)
 *   - Hash mismatches (hash points to wrong/missing issue)
 *   - Status mismatches (index vs git issue disagree)
 *   - Missing hashes (ticket has no hash, but matching issue exists)
 *
 * Usage:
 *   giwt sync              # dry-run report
 *   giwt sync --fix        # write fixes to index.json
 *   giwt sync --verbose    # show all entries
 *
 * --fix also resolves placeholder hashes (index hash with no git-issue /
 * commit provenance) by linking to a matching git issue (by extid). If no
 * matching issue exists, the placeholder is left in place (not mass-created
 * as a git issue — see BUG-plan-sync-fix-creates-orphan-git-issues).
 */

import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { log, raw } from "../utils/output";
import {
  type GitIssue,
  type IndexEntry,
  normalizeStatus,
  reconcile,
  type SyncReport,
  type TicketFile,
} from "./sync-ticket";

// ── Entry ─────────────────────────────────────────────────────

export interface SyncOptions {
  fix?: boolean;
  verbose?: boolean;
  /** Tickets dir relative to root; default ".plan/tickets" (settings.paths.tickets). */
  ticketsPath?: string;
}

/**
 * Run the ticket-index sync against `root` (the managed repo).
 * Returns the process exit code: 0 when in sync (or fixes resolved
 * everything), 1 when actionable issues remain or the run was refused.
 */
export function runSync(repoRoot: string, opts: SyncOptions = {}): number {
  const fixMode = opts.fix ?? false;
  const verbose = opts.verbose ?? false;
  const TICKETS_DIR = join(repoRoot, opts.ticketsPath ?? ".plan/tickets");
  const INDEX_PATH = join(TICKETS_DIR, "index.json");
  /** Serializes concurrent `--fix` runs (mkdir-based lock: atomic on POSIX). */
  const LOCK_PATH = join(TICKETS_DIR, ".index-sync.lock");

  // ── Parse ticket .md frontmatter ───────────────────────────────

  function parseTicketFile(filePath: string): TicketFile | null {
    try {
      const ticketText = readFileSync(filePath, "utf8");
      const lines = ticketText.split("\n").slice(0, 30); // only first 30 lines

      const filename = basename(filePath);

      // Extract title from first heading
      const titleMatch = lines.find((l) => l.startsWith("# "));
      const title = titleMatch?.replace(
        /^#\s+(?:TASK|FEAT|BUG|FIX|EPIC|SOL|INFRA|TEST|PERF|WIRE|IMPROVE):\s*/i,
        "",
      ).trim()
        ?? filename.replace(/\.md$/, "");

      // Extract metadata fields
      const statusMatch = ticketText.match(/\*\*Status:\*\*\s*(.+)/i);
      const priorityMatch = ticketText.match(/\*\*Priority:\*\*\s*(.+)/i);
      const epicMatch = ticketText.match(/\*\*Epic:\*\*\s*(.+)/i);

      // Extract type from heading
      const typeMatch = titleMatch?.match(
        /^#\s+(TASK|FEAT|BUG|FIX|EPIC|SOL|INFRA|TEST|PERF|WIRE|IMPROVE)/i,
      );
      const type = typeMatch?.[1]?.toUpperCase() ?? guessType(filename);

      // Extract git issue reference (e.g. "git issue: abc1234" or "Issue: abc1234")
      const gitIssueMatch = ticketText.match(/(?:git.?issue|issue):\s*([a-f0-9]{7,})/i);

      // Normalize status
      const rawStatus = statusMatch?.[1]?.trim() ?? "undefined";
      const status = normalizeStatus(rawStatus);

      return {
        path: filePath,
        filename,
        title,
        status,
        type,
        priority: priorityMatch?.[1]?.trim() ?? "medium",
        epic: epicMatch?.[1]?.trim() ?? "",
        hash: gitIssueMatch?.[1] ?? null,
        gitIssue: gitIssueMatch?.[1] ?? null,
      };
    } catch {
      return null;
    }
  }

  function guessType(filename: string): string {
    const prefix = filename.split("-")[0]?.toUpperCase();
    if (
      ["TASK", "FEAT", "BUG", "FIX", "EPIC", "SOL", "INFRA", "TEST", "PERF", "WIRE", "IMPROVE"]
        .includes(prefix ?? "")
    ) {
      return prefix!;
    }
    return "TASK";
  }

  // ── Read git issues ────────────────────────────────────────────

  interface GitIssueRead {
    issues: Map<string, GitIssue>;
    /** False when the `git issue` CLI itself is unavailable (vs genuinely zero issues). */
    available: boolean;
  }

  function readGitIssues(issuesRoot: string): GitIssueRead {
    const issues = new Map<string, GitIssue>();

    try {
      const output = execSync("git issue ls --all --format oneline 2>/dev/null", {
        encoding: "utf8",
        timeout: 10_000,
        cwd: issuesRoot,
      });

      for (const line of output.trim().split("\n")) {
        const m = line.match(/^([0-9a-f]{7,40})\s+(open|closed|done)\s+(.*)/);
        if (m === null || m[1] === undefined || m[2] === undefined || m[3] === undefined) continue;

        const hash = m[1].slice(0, 7);
        const status = m[2] as "open" | "closed" | "done";
        const title = m[3];

        // Extract extid from title (e.g. "TASK-006: Some title" → "TASK-006",
        // "TASK-chat-message-search: ..." → "TASK-CHAT-MESSAGE-SEARCH")
        const extidMatch = title.match(/^(TASK|FEAT|BUG|FIX|EPIC|SOL|INFRA)-[a-z0-9-]+/i);
        const extid = extidMatch?.[0]?.toUpperCase() ?? null;

        issues.set(hash, { hash, status, title, extid });
      }
    } catch {
      // git issue not available — report explicitly so --fix can refuse safely
      return { issues, available: false };
    }

    return { issues, available: true };
  }

  // ── Fix-mode lock (serializes concurrent --fix runs) ───────────

  function isLockStale(lockPath: string): boolean {
    try {
      const pid = parseInt(readFileSync(join(lockPath, "owner.pid"), "utf8").trim(), 10);
      if (!Number.isInteger(pid)) return true;
      try {
        process.kill(pid, 0); // signal 0 = liveness probe, no signal delivered
        return false; // owner alive — lock genuinely held
      } catch (e) {
        // EPERM: process exists but is not ours → alive, do not break.
        return (e as NodeJS.ErrnoException).code !== "EPERM";
      }
    } catch {
      return true; // missing/unreadable pid file — nothing alive claims it
    }
  }

  function acquireFixLock(lockPath: string): boolean {
    if (existsSync(lockPath)) {
      if (!isLockStale(lockPath)) {
        log(
          "error",
          String(`Another index sync is in progress (lock: ${lockPath}).`).replace(/\n$/, ""),
        );
        return false;
      }
      rmSync(lockPath, { recursive: true, force: true });
      log(
        "warn",
        String("Removed stale index-sync lock left by a dead process").replace(/\n$/, ""),
      );
    }
    mkdirSync(lockPath);
    writeFileSync(join(lockPath, "owner.pid"), `${process.pid}\n`);
    return true;
  }

  function releaseFixLock(lockPath: string): void {
    try {
      rmSync(lockPath, { recursive: true, force: true });
    } catch {
      // already gone — nothing to release
    }
  }

  // ── Read index.json ────────────────────────────────────────────

  function readIndex(indexPath: string): Record<string, IndexEntry> {
    if (!existsSync(indexPath)) return {};
    try {
      return JSON.parse(readFileSync(indexPath, "utf8"));
    } catch {
      return {};
    }
  }

  // ── Apply fixes ────────────────────────────────────────────────

  function applyFixes(
    index: Record<string, IndexEntry>,
    report: SyncReport,
    ticketFiles: TicketFile[],
    gitIssues: Map<string, GitIssue>,
    ticketsDir: string,
  ): Record<string, IndexEntry> {
    const fixed = { ...index };
    const fileByExtid = new Map<string, TicketFile>();
    for (const tf of ticketFiles) {
      const extid = tf.filename.replace(/\.md$/, "").toUpperCase();
      fileByExtid.set(extid, tf);
    }

    // Backfill ticket `status` from the on-disk .md (Status: <state>) into
    // index entries that have none. Existing index entries are NEVER
    // overwritten here — once a status has been set (by this pass, by the
    // statusMismatches fix below, or by hand), the index is treated as
    // authoritative. This keeps the backfill idempotent and prevents
    // oscillation with the statusMismatches fix when the .md status text
    // uses a form `normalizeStatus` cannot reduce (e.g. "📝 Draft"
    // normalizes to "draft" while git is "done"). The 186 stale-open
    // bookkeeping gaps this unblocks are auto-corrected by the
    // statusMismatches pass once the index has a normalized status to
    // compare against.
    for (const tf of ticketFiles) {
      const extid = tf.filename.replace(/\.md$/, "").toUpperCase();
      const cur = fixed[extid];
      if (!cur) continue;
      if (cur.status !== undefined) continue;
      fixed[extid] = { ...cur, status: normalizeStatus(tf.status) };
      report.fixesApplied.push(
        `${extid}: backfilled status (was undefined) → "${normalizeStatus(tf.status)}"`,
      );
    }

    // Fix status mismatches
    for (const mismatch of report.statusMismatches) {
      const cur = fixed[mismatch.extid];
      if (cur) {
        fixed[mismatch.extid] = {
          ...cur,
          status: mismatch.gitStatus,
        };
        report.fixesApplied.push(
          `${mismatch.extid}: status ${mismatch.indexStatus} → ${mismatch.gitStatus}`,
        );
      }
    }

    // Fix missing hashes
    for (const missing of report.missingHashes) {
      const cur = fixed[missing.extid];
      if (cur) {
        fixed[missing.extid] = {
          ...cur,
          hash: missing.suggestedHash!,
        };
        report.fixesApplied.push(`${missing.extid}: added hash ${missing.suggestedHash}`);
      }
    }

    // Fix placeholder hashes: index hash points to no git issue and is not a
    // real commit (no provenance at all). Resolve by linking to a matching git
    // issue (by extid). If no matching issue exists, the placeholder is left
    // in place — mass-creating git issues for unprovenanced entries produced
    // orphan floods (see BUG-plan-sync-fix-creates-orphan-git-issues).
    for (const ph of report.placeholderHashes) {
      const entry = fixed[ph.extid];
      if (!entry) continue;

      // 1. Try a matching git issue by extid.
      let target: GitIssue | undefined;
      for (const [, issue] of gitIssues) {
        if (issue.extid === ph.extid) {
          target = issue;
          break;
        }
      }

      // 2. Otherwise leave the placeholder as-is. Mass-creating git issues
      //    for unprovenanced index entries produced a flood of orphan issues
      //    (see BUG-plan-sync-fix-creates-orphan-git-issues); let the user
      //    open the issue explicitly when they're ready.
      if (!target) {
        report.fixesApplied.push(
          `${ph.extid}: SKIPPED placeholder fix — no matching git issue (orphan left in place)`,
        );
        continue;
      }

      // 3. Update the index entry.
      fixed[ph.extid] = {
        ...entry,
        hash: target.hash,
        git_issue: target.hash,
      };
      report.fixesApplied.push(
        `${ph.extid}: replaced placeholder ${ph.indexHash} → ${target.hash}`,
      );

      // 4. Update the .md file's git issue ref if present.
      const tf = fileByExtid.get(ph.extid);
      if (tf) {
        try {
          let ticketRaw = readFileSync(tf.path, "utf8");
          if (/(?:git.?issue|issue):\s*[0-9a-f]{7,}/i.test(ticketRaw)) {
            ticketRaw = ticketRaw.replace(
              /(?:git.?issue|issue):\s*[0-9a-f]{7,}/i,
              `git issue: ${target.hash}`,
            );
          } else {
            ticketRaw = ticketRaw.replace(/(\n---\n|$)/, `\n\ngit issue: ${target.hash}\n`);
          }
          writeFileSync(tf.path, ticketRaw);
          report.fixesApplied.push(`${ph.extid}: linked .md to git issue ${target.hash}`);
        } catch {
          // non-fatal: the index entry itself is already corrected
        }
      }
    }

    // Fix phantom entries by trying to find matching files with different names.
    // Only relocate entries whose source is empty or already under
    // .plan/tickets/ — never rewrite a distinct source (e.g. .plan/epics/*.md)
    // to a guessed path.
    for (const extid of report.phantomEntries) {
      if (!fixed[extid]) continue;

      const src = fixed[extid].source ?? "";
      if (src && !src.startsWith(".plan/tickets/")) continue;

      // Try different file name patterns
      const patterns = [
        `${extid}.md`,
        `${extid.toLowerCase()}.md`,
        `TASK-${extid.toLowerCase()}.md`,
        `FEAT-${extid.toLowerCase()}.md`,
        `BUG-${extid.toLowerCase()}.md`,
      ];

      for (const pattern of patterns) {
        const filePath = join(ticketsDir, pattern);
        if (existsSync(filePath)) {
          fixed[extid] = {
            ...fixed[extid],
            source: `.plan/tickets/${pattern}`,
          };
          report.fixesApplied.push(`${extid}: fixed source path to ${pattern}`);
          break;
        }
      }
    }

    // Add orphan files to index (skip if source path already exists in any entry)
    const existingSources = new Set(
      Object.values(fixed).map((e) => e.source?.toLowerCase()),
    );

    for (const filename of report.orphanFiles) {
      const extid = filename.replace(/\.md$/, "").toUpperCase();
      if (fixed[extid]) continue; // key already exists

      const sourcePath = `.plan/tickets/${filename}`;
      if (existingSources.has(sourcePath.toLowerCase())) continue; // source already tracked

      const tf = fileByExtid.get(extid);
      if (!tf) continue;

      // Resolve the ticket's OWN git issue: authoritative registry lookup by
      // extid FIRST. tf.hash originates from an explicit "git issue:" line in
      // the .md and may be stale or absent — never trusted over the registry.
      let gitIssueHash: string | null = null;
      for (const [, issue] of gitIssues) {
        if (issue.status === "open" && issue.extid === extid) {
          gitIssueHash = issue.hash;
          break;
        }
      }
      // Fall back to the ticket's own "git issue:" reference only if it still
      // resolves to an OPEN issue — a closed/stale hash (or one no longer in
      // the registry) must not leak a dead git_issue link into the index.
      const fallback = tf.gitIssue;
      if (!gitIssueHash && fallback && gitIssues.get(fallback)?.status === "open") {
        gitIssueHash = fallback;
      }

      fixed[extid] = {
        hash: gitIssueHash ?? "pending",
        ...(gitIssueHash !== null ? { git_issue: gitIssueHash } : {}),
        extid,
        type: tf.type,
        title: tf.title,
        label: tf.type.toLowerCase(),
        priority: tf.priority,
        epic: tf.epic,
        tags: [],
        source: sourcePath,
        status: normalizeStatus(tf.status),
      };
      existingSources.add(sourcePath.toLowerCase());
      report.fixesApplied.push(`${extid}: added to index (from orphan file)`);
    }

    // Fix missing git_issue links
    for (const m of report.missingGitIssueLinks) {
      const cur = fixed[m.extid];
      if (cur) {
        fixed[m.extid] = {
          ...cur,
          git_issue: m.suggestedGitIssue,
        };
        report.fixesApplied.push(`${m.extid}: added git_issue = ${m.suggestedGitIssue}`);
      }
    }

    // Relink entries whose hash points to a CLOSED issue when an OPEN
    // duplicate sharing the same extid exists (ticket was re-created; the old
    // issue was closed). Keeps index bound to the live issue.
    for (const [extid, entry] of Object.entries(fixed)) {
      const cur = entry.hash ? gitIssues.get(entry.hash) : undefined;
      if (!cur || cur.status !== "closed") continue;
      let openDup: GitIssue | null = null;
      for (const [, issue] of gitIssues) {
        if (issue.status === "open" && issue.extid === extid) {
          openDup = issue;
          break;
        }
      }
      if (openDup) {
        fixed[extid] = { ...entry, hash: openDup.hash, git_issue: openDup.hash };
        report.fixesApplied.push(`${extid}: relinked closed ${cur.hash} → open ${openDup.hash}`);
      }
    }

    // Close stale open git issues (index=done, git=open)
    for (const m of report.staleOpenGitIssues) {
      try {
        execSync(
          `git issue state ${m.gitIssueHash} --close -m 'Auto-closed: ticket ${m.extid} marked done in index.json'`,
          { timeout: 10_000, cwd: repoRoot },
        );
        report.fixesApplied.push(`${m.extid}: closed git issue ${m.gitIssueHash}`);
      } catch {
        report.fixesApplied.push(`${m.extid}: FAILED to close git issue ${m.gitIssueHash}`);
      }
    }

    return fixed;
  }

  // Read sources
  if (!existsSync(TICKETS_DIR)) {
    log("error", String(`Tickets directory not found: ${TICKETS_DIR}`).replace(/\n$/, ""));
    return 1;
  }

  const mdFiles = readdirSync(TICKETS_DIR).filter(
    (f) =>
      f.endsWith(".md") && /^(TASK|FEAT|BUG|FIX|EPIC|SOL|INFRA|TEST|PERF|WIRE|IMPROVE)-/i.test(f),
  );

  const ticketFiles: TicketFile[] = [];
  for (const f of mdFiles) {
    const tf = parseTicketFile(join(TICKETS_DIR, f));
    if (tf) ticketFiles.push(tf);
  }

  const { issues: gitIssues, available: gitIssuesAvailable } = readGitIssues(repoRoot);
  const index = readIndex(INDEX_PATH);

  raw(`\n📊 Scanning...`);
  raw(`   Ticket .md files:  ${ticketFiles.length}`);
  raw(
    `   Git issues:        ${gitIssues.size}${
      gitIssuesAvailable ? "" : " (git issue CLI unavailable)"
    }`,
  );
  raw(`   Index entries:     ${Object.keys(index).length}`);

  // Reconcile
  const report = reconcile(ticketFiles, gitIssues, index, verbose, repoRoot);

  // Report
  raw(`\n📋 Reconciliation Report`);
  raw(`${"─".repeat(60)}`);

  if (report.orphanFiles.length > 0) {
    raw(`\n🔴 Orphan files (.md not in index): ${report.orphanFiles.length}`);
    if (verbose) {
      report.orphanFiles.forEach((f) => raw(`   ${f}`));
    } else {
      report.orphanFiles.slice(0, 10).forEach((f) => raw(`   ${f}`));
      if (report.orphanFiles.length > 10) {
        raw(`   ... and ${report.orphanFiles.length - 10} more`);
      }
    }
  } else {
    raw(`\n🟢 No orphan files`);
  }

  if (report.phantomEntries.length > 0) {
    raw(`\n🔴 Phantom entries (index has no .md): ${report.phantomEntries.length}`);
    if (verbose) {
      report.phantomEntries.forEach((e) => raw(`   ${e}`));
    } else {
      report.phantomEntries.slice(0, 10).forEach((e) => raw(`   ${e}`));
      if (report.phantomEntries.length > 10) {
        raw(`   ... and ${report.phantomEntries.length - 10} more`);
      }
    }
  } else {
    raw(`\n🟢 No phantom entries`);
  }

  if (report.hashMismatches.length > 0) {
    raw(`\n🔴 Hash mismatches: ${report.hashMismatches.length}`);
    for (const m of report.hashMismatches) {
      raw(
        `   ${m.extid}: index=${m.indexHash} → git="${m.gitTitle ?? "NOT FOUND"}" (${
          m.gitStatus ?? "?"
        })`,
      );
    }
  } else {
    raw(`\n🟢 No hash mismatches`);
  }

  if (report.placeholderHashes.length > 0) {
    raw(`\n🟡 Placeholder hashes (no git issue, not a commit): ${report.placeholderHashes.length}`);
    for (const m of report.placeholderHashes) {
      raw(`   ${m.extid}: index=${m.indexHash}`);
    }
  } else {
    raw(`\n🟢 No placeholder hashes`);
  }

  if (report.statusMismatches.length > 0) {
    raw(`\n🟡 Status mismatches: ${report.statusMismatches.length}`);
    for (const m of report.statusMismatches) {
      raw(`   ${m.extid}: index=${m.indexStatus} vs git=${m.gitStatus}`);
    }
  } else {
    raw(`\n🟢 No status mismatches`);
  }

  if (report.missingHashes.length > 0) {
    raw(`\n🟡 Missing hashes (could be linked): ${report.missingHashes.length}`);
    if (verbose) {
      for (const m of report.missingHashes) {
        raw(`   ${m.extid}: suggested hash=${m.suggestedHash} (git="${m.suggestedTitle}")`);
      }
    } else {
      report.missingHashes.slice(0, 10).forEach((m) => {
        raw(`   ${m.extid}: → ${m.suggestedHash}`);
      });
      if (report.missingHashes.length > 10) {
        raw(`   ... and ${report.missingHashes.length - 10} more`);
      }
    }
  } else {
    raw(`\n🟢 No missing hashes`);
  }

  // ── New: git_issue link + stale + orphan checks ──────────────

  if (report.missingGitIssueLinks.length > 0) {
    raw(
      `\n🟡 Missing git_issue links (index entry has no git_issue field): ${report.missingGitIssueLinks.length}`,
    );
    for (const m of report.missingGitIssueLinks) {
      raw(`   ${m.extid}: → ${m.suggestedGitIssue} (git="${m.gitTitle}")`);
    }
  } else {
    raw(`\n🟢 No missing git_issue links`);
  }

  if (report.staleOpenGitIssues.length > 0) {
    raw(`\n🔴 Stale open git issues (index=done, git=open): ${report.staleOpenGitIssues.length}`);
    for (const m of report.staleOpenGitIssues) {
      raw(`   ${m.extid}: git issue ${m.gitIssueHash} still open`);
    }
  } else {
    raw(`\n🟢 No stale open git issues`);
  }

  if (report.orphanGitIssues.length > 0) {
    raw(`\n🟡 Orphan git issues (open, no index entry): ${report.orphanGitIssues.length}`);
    for (const m of report.orphanGitIssues) {
      raw(`   ${m.hash} ${m.extid}: ${m.title.slice(0, 60)}`);
    }
  } else {
    raw(`\n🟢 No orphan git issues`);
  }

  // Summary — only *actionable* issues gate the result. Placeholder hashes,
  // missing-hash suggestions, missing git_issue links, and orphan git issues
  // are advisory (yellow), not failures.  Stale open git issues are actionable.
  const totalIssues = report.orphanFiles.length
    + report.phantomEntries.length
    + report.hashMismatches.length
    + report.statusMismatches.length
    + report.staleOpenGitIssues.length;
  const advisoryCount = report.placeholderHashes.length
    + report.missingHashes.length
    + report.missingGitIssueLinks.length
    + report.orphanGitIssues.length;

  raw(`\n${"═".repeat(60)}`);

  // Apply fixes (also when only advisory issues exist — e.g. missing-hash links)
  if (fixMode && (totalIssues > 0 || advisoryCount > 0)) {
    // With the issue registry unreadable, every non-commit hash looks like a
    // placeholder — --fix would mass-create issues. Refuse instead.
    if (!gitIssuesAvailable) {
      log("error", String(`git issue CLI unavailable — refusing to --fix.`).replace(/\n$/, ""));
      log(
        "error",
        String("  Fix mode cannot distinguish a missing tool from stale hashes.").replace(
          /\n$/,
          "",
        ),
      );
      return 1;
    }

    if (!acquireFixLock(LOCK_PATH)) {
      return 1;
    }
    let fixedIndex: Record<string, IndexEntry>;
    try {
      raw(`\n🔧 Applying fixes...`);
      fixedIndex = applyFixes(index, report, ticketFiles, gitIssues, TICKETS_DIR);

      // Sort by extid
      const sorted = Object.fromEntries(
        Object.entries(fixedIndex).sort(([a], [b]) => a.localeCompare(b)),
      );

      // Atomic write: temp file + rename, so a crash mid-write cannot
      // truncate index.json.
      const tmpPath = `${INDEX_PATH}.tmp-${process.pid}`;
      writeFileSync(tmpPath, JSON.stringify(sorted, null, 2) + "\n");
      renameSync(tmpPath, INDEX_PATH);
    } finally {
      // Never leak the lock on a failed fix run.
      releaseFixLock(LOCK_PATH);
    }
    raw(`Wrote ${INDEX_PATH}`);

    if (report.fixesApplied.length > 0) {
      raw(`\nChanges:`);
      report.fixesApplied.forEach((f) => raw(`   ${f}`));
    }

    // Recompute reconciliation on the *fixed* index so the summary reflects the
    // resolved state (e.g. placeholder hashes now linked, not still advisory).
    const postReport = reconcile(ticketFiles, gitIssues, fixedIndex, verbose, repoRoot);
    const postTotal = postReport.orphanFiles.length
      + postReport.phantomEntries.length
      + postReport.hashMismatches.length
      + postReport.statusMismatches.length
      + postReport.staleOpenGitIssues.length;
    const postAdvisory = postReport.placeholderHashes.length
      + postReport.missingHashes.length
      + postReport.missingGitIssueLinks.length
      + postReport.orphanGitIssues.length;

    if (postTotal === 0) {
      raw(`Index is in sync${postAdvisory > 0 ? ` (${postAdvisory} advisory remaining)` : ""}`);
    } else {
      raw(
        `${postTotal} actionable issue(s) remain${
          postAdvisory > 0 ? `, ${postAdvisory} advisory` : ""
        }`,
      );
    }
    return postTotal > 0 ? 1 : 0;
  }

  if (fixMode && totalIssues === 0) {
    raw(`\nNothing to fix`);
  } else if (totalIssues > 0) {
    raw(`\nRun with --fix to apply automatic fixes`);
  }

  if (totalIssues === 0) {
    raw(`Index is in sync${advisoryCount > 0 ? ` (${advisoryCount} advisory)` : ""}`);
  } else {
    raw(
      `${totalIssues} actionable issue(s) found${
        advisoryCount > 0 ? `, ${advisoryCount} advisory` : ""
      }`,
    );
  }

  // Exit code
  return totalIssues > 0 ? 1 : 0;
}
