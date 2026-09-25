// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Sync .plan/tickets/index.json with ticket .md files and git issues.
 *
 * Reads:
 *   1. .plan/tickets/*.md — extract frontmatter (title, status, type, priority, epic, tags)
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

import { execFileSync, execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { isolatedGitEnv } from "../utils/git";
import { log, raw } from "../utils/output";
import {
  type GitIssue,
  type IndexEntry,
  normalizeStatus,
  reconcile,
  type SyncReport,
  type TicketFile,
} from "./sync-ticket";

// ── Ticket .md parsing ────────────────────────────────────────

/**
 * One `**Status:**` / `**Status**:` line (colon inside or outside the bold;
 * `status = value` and list/quote prefixes accepted). Mirrors omp-plugins
 * find-work's STATUS_LINE_RE so giwt's index and /find-work's roster
 * classify the same files — including dual-status reconciliation stubs.
 */
const STATUS_LINE_RE =
  /^\s*(?:[-*>]\s*)?(?:\*\*)?\s*status\s*(?:\*\*)?\s*[:=]\s*(?:\*\*)?\s*(.+?)\s*(?:\*\*)?\s*$/i;
/**
 * Parse a ticket .md file into a TicketFile.
 *
 * Metadata fields (**Status:**, **Priority:**, **Epic:**, **Tags:**) are
 * matched against the header region (first 30 lines) only — whole-file
 * matching captured body prose into the epic field. The git-issue
 * reference is still matched against the whole file: applyFixes appends
 * it at the end of the file, beyond the header region.
 */
export function parseTicketFile(filePath: string, source?: string): TicketFile | null {
  try {
    const ticketText = readFileSync(filePath, "utf8");
    const lines = ticketText.split("\n").slice(0, 30); // header region only
    const header = lines.join("\n");

    const filename = basename(filePath);

    // Extract title from first heading
    const titleMatch = lines.find((l) => l.startsWith("# "));
    const title = titleMatch?.replace(
      /^#\s+(?:TASK|FEAT|BUG|FIX|EPIC|SOL|INFRA|TEST|PERF|WIRE|IMPROVE):\s*/i,
      "",
    ).trim()
      ?? filename.replace(/\.md$/, "");

    // Extract metadata fields (header region only — body prose mentioning
    // **Epic:**/**Tags:** must not pollute the index fields)
    const priorityMatch = header.match(/\*\*Priority:\*\*\s*(.+)/i);
    const epicMatch = header.match(/\*\*Epic:\*\*\s*(.+)/i);
    const tagsMatch = header.match(/\*\*Tags:\*\*\s*(.+)/);

    // Extract type from heading
    const typeMatch = titleMatch?.match(
      /^#\s+(TASK|FEAT|BUG|FIX|EPIC|SOL|INFRA|TEST|PERF|WIRE|IMPROVE)/i,
    );
    const type = typeMatch?.[1]?.toUpperCase() ?? guessType(filename);

    // Extract git issue reference (e.g. "git issue: abc1234" or "Issue: abc1234")
    const gitIssueMatch = ticketText.match(/(?:git.?issue|issue):\s*([a-f0-9]{7,})/i);

    // Normalize status — mirror omp-plugins find-work's planFileTicket
    // (BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick):
    // reconciled tickets can carry multiple status lines (legacy
    // `**Status:** Not Started → closed (duplicate)` + follow-up
    // `**Status**: duplicate-of-…`); ANY done-class line closes the ticket.
    // When none is done-class the FIRST line wins, preserving
    // in_progress/draft detection from the primary Status.
    const statusValues = lines
      .map((l) => STATUS_LINE_RE.exec(l)?.[1]?.trim() ?? "")
      .filter((v) => v.length > 0);
    const rawStatus = statusValues[0] ?? "undefined";
    const status = statusValues.some((v) => normalizeStatus(v) === "done")
      ? "done"
      : normalizeStatus(rawStatus);

    return {
      path: filePath,
      filename,
      title,
      status,
      statusValues,
      type,
      priority: priorityMatch?.[1]?.trim() ?? "medium",
      epic: epicMatch?.[1]?.trim() ?? "",
      tags: tagsMatch?.[1]?.split(",").map((t) => t.trim()).filter(Boolean) ?? [],
      hash: gitIssueMatch?.[1] ?? null,
      gitIssue: gitIssueMatch?.[1] ?? null,
      source: source ?? filePath,
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

// ── Entry ─────────────────────────────────────────────────────

/**
 * Point a ticket .md's `git issue:` reference at `hash` — replacing an
 * existing reference line or appending one past the header region.
 */
function appendIssueRef(mdPath: string, hash: string): void {
  let text = readFileSync(mdPath, "utf8");
  if (/(?:git.?issue|issue):\s*[0-9a-f]{7,}/i.test(text)) {
    text = text.replace(/(?:git.?issue|issue):\s*[0-9a-f]{7,}/i, `git issue: ${hash}`);
  } else {
    text = text.replace(/(\n---\n|$)/, `\n\ngit issue: ${hash}\n`);
  }
  writeFileSync(mdPath, text);
}

export interface SyncOptions {
  fix?: boolean;
  verbose?: boolean;
  /** Tickets dir relative to root; default ".plan/tickets" (settings.paths.tickets). */
  ticketsPath?: string;
  /**
   * With `--fix`: additionally create registry issues for plan files that
   * have none (`.md` → `git issue create` + link). Opt-in because mass
   * import on a repo full of plan-only files recreates the orphan-flood
   * failure mode (see BUG-plan-sync-fix-creates-orphan-git-issues); plain
   * `--fix` only reports them as importable tickets.
   */
  import?: boolean;
  /**
   * With `--fix`: additionally import foreign registry issues back into
   * `.plan/` — generate `.md` + index entry for each open issue whose extid
   * has no plan file and no index entry. Off by default because import-back
   * can resurrect tickets that were deliberately deleted; explicit opt-in.
   */
  importBack?: boolean;
  /** Called once with the final counts when a scan ran to completion
   *  (dry-run or fix mode, any exit code). Not called on early refusals
   *  (missing tickets dir, --fix lock/CLI refusal). */
  onSummary?: (summary: SyncSummary) => void;
}

/** Final ticket-sync counts, for run-record outcome summaries. */
export interface SyncSummary {
  /** Ticket .md files scanned. */
  tickets: number;
  /** Automatic fixes applied to the index (0 in dry-run). */
  fixesApplied: number;
  /** Actionable issues remaining after the run (drives the exit code). */
  issuesRemaining: number;
  /** Advisory (non-gating) findings remaining. */
  advisoryRemaining: number;
}

/**
 * Run the ticket-index sync against `root` (the managed repo).
 * Returns the process exit code: 0 when in sync (or fixes resolved
 * everything), 1 when actionable issues remain or the run was refused.
 */
export function runSync(repoRoot: string, opts: SyncOptions = {}): number {
  const fixMode = opts.fix ?? false;
  const verbose = opts.verbose ?? false;
  const TICKETS_DIR = resolve(repoRoot, opts.ticketsPath ?? ".plan/tickets");
  const INDEX_PATH = join(TICKETS_DIR, "index.json");
  /** Serializes concurrent `--fix` runs (mkdir-based lock: atomic on POSIX). */
  const LOCK_PATH = join(TICKETS_DIR, ".index-sync.lock");
  const epicsDir = resolve(repoRoot, ".plan/epics");
  /** Repo-relative plan-dir prefixes shared by reconcile (candidate search)
   *  and applyFixes (relocation + index `source` fields) — custom
   *  `ticketsPath` aware so report and fix modes agree. */
  const ticketsPrefix = relative(repoRoot, TICKETS_DIR);
  const epicsPrefix = relative(repoRoot, epicsDir);

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
        // Isolate from ambient GIT_* hook context (see isolatedGitEnv).
        env: isolatedGitEnv(),
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
        // Extid chars are constrained to [A-Z0-9-] here, so it is safe to
        // use as a path segment downstream (import-back filenames).

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
    let ageMs = Number.POSITIVE_INFINITY;
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
      // No readable pid: the owner may be inside the mkdir→writeFileSync
      // window — a fresh lock counts as held; an aged or vanished one is
      // stale (ageMs stays Infinity when the lock is already gone).
      try {
        ageMs = Date.now() - statSync(lockPath).mtimeMs;
      } catch {
        // lock vanished — nothing alive claims it
      }
    }
    return ageMs > 5_000;
  }

  function acquireFixLock(lockPath: string): boolean {
    // mkdir is the atomic test-and-set — no existsSync→mkdir TOCTOU window.
    try {
      mkdirSync(lockPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST" || !isLockStale(lockPath)) {
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
      // Losing the reclaim race twice in a row is beyond mitigation — let
      // the error propagate; the dispatcher exits non-zero.
      mkdirSync(lockPath);
    }
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
        // Converge in one pass: rewrite the .md Status line too, so the
        // post-fix re-scan does not re-surface it as a new .md-status fix.
        const tf = fileByExtid.get(mismatch.extid);
        if (tf) {
          try {
            const text = readFileSync(tf.path, "utf8").replace(
              /^((?:\*\*)?\s*status\s*(?:\*\*)?\s*[:=]\s*(?:\*\*)?\s*).*$/gim,
              `$1${mismatch.gitStatus}`,
            );
            writeFileSync(tf.path, text);
          } catch {
            // non-fatal: index entry already corrected; .md fixed next run
          }
        }
      }
    }

    // Fix lagging index entries outranked by an appended .md done-marker
    // (reconciler convention: a later Status line is the newer state).
    // Flip the index to done and close the linked open issue in the same
    // pass — reconcile ran before the flip, so deferring to the
    // staleOpenGitIssues pass would burn an extra run.
    for (const m of report.indexStatusStale) {
      const cur = fixed[m.extid];
      if (!cur) continue;
      fixed[m.extid] = { ...cur, status: "done" };
      report.fixesApplied.push(
        `${m.extid}: index status ${m.indexStatus} → done (appended .md marker)`,
      );
      if (cur.git_issue && gitIssues.get(cur.git_issue)?.status === "open") {
        try {
          execSync(
            `git issue state ${cur.git_issue} --close -m 'Auto-closed: appended .md marker marks ${m.extid} done'`,
            { timeout: 10_000, cwd: repoRoot, env: isolatedGitEnv() },
          );
          report.fixesApplied.push(`${m.extid}: closed git issue ${cur.git_issue}`);
        } catch {
          // non-fatal: the next run's staleOpenGitIssues pass closes it
        }
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
          appendIssueRef(tf.path, target.hash);
          report.fixesApplied.push(`${ph.extid}: linked .md to git issue ${target.hash}`);
        } catch {
          // non-fatal: the index entry itself is already corrected
        }
      }
    }

    // Fix phantom entries by trying to find matching files with different names.
    // Search both `ticketsDir` (default `.plan/tickets/`, overridable via
    // `ticketsPath`) and the canonical `.plan/epics/` sibling dir (epics
    // live there with the same filename conventions). The earlier code
    // only searched `ticketsDir`, which left EPIC-* entries with their
    // `source` pinned to `.plan/tickets/epic-foo.md` while the actual
    // file lived in `.plan/epics/epic-foo.md` — see
    // TASK-plan-index-orphan-phantom-cleanup for the 297-phantom debt.
    // ticketsPrefix/epicsPrefix/epicsDir live in runSync scope — shared with
    // the reconcile call so report-only and fix modes see the same dirs.
    for (const extid of report.phantomEntries) {
      const entry = fixed[extid];
      if (!entry) continue;

      // Never re-anchor a distinct source (a custom external path, a file
      // on another branch/worktree, a temporary rename) to a guessed path —
      // only entries whose source is empty or already managed by this
      // sync (tickets/epics dirs) may be relocated.
      const src = entry.source ?? "";
      const managed = src === ""
        || src.startsWith(`${ticketsPrefix}/`)
        || src.startsWith(`${epicsPrefix}/`)
        || src.startsWith(".plan/tickets/"); // historical canonical sources
      if (!managed) continue;
      // Out-of-repo tickets dir → relative() yields `../…` garbage; never
      // write that into the index.
      if (ticketsPrefix.startsWith("..") || epicsPrefix.startsWith("..")) continue;

      const lc = extid.toLowerCase();
      const patterns: Array<{ dir: string; prefix: string; }> = [
        { dir: ticketsDir, prefix: ticketsPrefix },
        { dir: epicsDir, prefix: epicsPrefix },
      ];
      const fileNames = [
        `${extid}.md`,
        `${lc}.md`,
        `TASK-${lc}.md`,
        `FEAT-${lc}.md`,
        `BUG-${lc}.md`,
        `epic-${lc}.md`,
        `EPIC-${lc}.md`,
      ];

      let relocated = false;
      for (const { dir, prefix } of patterns) {
        for (const name of fileNames) {
          const filePath = join(dir, name);
          if (existsSync(filePath)) {
            fixed[extid] = {
              ...entry,
              source: `${prefix}/${name}`,
            };
            report.fixesApplied.push(
              `${extid}: fixed source path to ${prefix}/${name}`,
            );
            relocated = true;
            break;
          }
        }
        if (relocated) break;
      }
    }

    // Add orphan files to index (skip if source path already exists in any entry)
    const existingSources = new Set(
      Object.values(fixed).map((e) => e.source?.toLowerCase()),
    );

    for (const filename of report.orphanFiles) {
      const extid = filename.replace(/\.md$/, "").toUpperCase();
      if (fixed[extid]) continue; // key already exists

      const sourcePath = `${ticketsPrefix}/${filename}`;
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
        tags: tf.tags,
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

    // Import: create registry issues for plan files that have none. Unlike
    // the placeholder fix (which deliberately never mass-creates for
    // unprovenanced index entries), an existing .md file IS provenance —
    // one bounded create per file, idempotent by extid. Opt-in (`--import`):
    // plain --fix only reports importable tickets, never mass-creates.
    if (opts.import) {
      for (const it of report.importableTickets) {
        const tf = fileByExtid.get(it.extid);
        if (!tf) continue;
        try {
          const out = execFileSync(
            "git",
            ["issue", "create", `${it.extid}: ${it.title}`, "-m", `Imported from ${it.source}`],
            { timeout: 10_000, cwd: repoRoot, env: isolatedGitEnv(), encoding: "utf8" },
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

    // Title drift: the ticket was reclassified/moved (TASK-x → BUG-x); rename
    // the registry issue to match and relink file + index to it.
    for (const td of report.titleDrifts) {
      try {
        const strippedTitle = td.issueTitle.replace(/^\S+[:-]?\s*/, "");
        execFileSync(
          "git",
          ["issue", "edit", td.hash, "-t", `${td.extid}: ${strippedTitle}`],
          { timeout: 10_000, cwd: repoRoot, env: isolatedGitEnv(), encoding: "utf8" },
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

    // .md Status drift: rewrite EVERY header Status line to the
    // authoritative index status (the linked issue already agrees with the
    // index) — rewriting only the first line would leave an appended line
    // re-diverging the any-done aggregate on the next scan.
    for (const ms of report.mdStatusStale) {
      const tf = fileByExtid.get(ms.extid);
      if (!tf) continue;
      try {
        let text = readFileSync(tf.path, "utf8");
        text = text.replace(
          /^((?:\*\*)?\s*status\s*(?:\*\*)?\s*[:=]\s*(?:\*\*)?\s*).*$/gim,
          `$1${ms.indexStatus}`,
        );
        writeFileSync(tf.path, text);
        report.fixesApplied.push(
          `${ms.extid}: .md status ${ms.mdStatus} → ${ms.indexStatus}`,
        );
      } catch (e) {
        report.fixesApplied.push(
          `${ms.extid}: FAILED to rewrite .md status: ${
            e instanceof Error ? e.message.split("\n")[0] : String(e)
          }`,
        );
      }
    }

    // Import-back: generate .md + index entry for foreign registry issues.
    // Explicit opt-in (`--import-back`) — this can resurrect deliberately
    // deleted tickets, so it never runs as part of plain --fix.
    if (opts.importBack) {
      for (const fi of report.foreignIssues) {
        try {
          const type = /^([A-Z]+)-/.exec(fi.extid)?.[1] ?? "TASK";
          const bareTitle = fi.title.replace(/^\S+[:]\s*/, "");
          const filename = `${fi.extid}.md`;
          const target = join(TICKETS_DIR, filename);
          // Never clobber an existing plan file in the target dir — or in the
          // canonical .plan/tickets location when syncing a custom dir.
          const canonical = join(resolve(repoRoot, ".plan/tickets"), filename);
          if (existsSync(target) || (canonical !== target && existsSync(canonical))) {
            report.fixesApplied.push(
              `${fi.extid}: SKIPPED import-back — ${filename} already exists`,
            );
            continue;
          }
          writeFileSync(
            target,
            [
              `# ${type}: ${bareTitle}`,
              "",
              `**Status:** open`,
              "**Priority:** medium",
              "",
              `Imported from git issue ${fi.hash}.`,
              "",
              `git issue: ${fi.hash}`,
              "",
            ].join("\n"),
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
            source: `${ticketsPrefix}/${filename}`,
            status: "open",
          };
          report.fixesApplied.push(
            `${fi.extid}: imported back git issue ${fi.hash} → ${ticketsPrefix}/${filename}`,
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

    // Close stale open git issues (index=done, git=open)
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

  // Epics live in a sibling dir (.plan/epics) with the same filename
  // conventions; scan it so epic files take part in every reconciliation
  // pass (import, adoption, phantom checks) instead of being invisible.
  const EPICS_DIR = resolve(repoRoot, ".plan/epics");
  const epicFiles = existsSync(EPICS_DIR)
    ? readdirSync(EPICS_DIR).filter(
      (f) =>
        f.endsWith(".md")
        && /^(TASK|FEAT|BUG|FIX|EPIC|SOL|INFRA|TEST|PERF|WIRE|IMPROVE)-/i.test(f),
    )
    : [];

  const scanTicketFiles = (): TicketFile[] => {
    const files: TicketFile[] = [];
    for (const [dir, list] of [[TICKETS_DIR, mdFiles], [EPICS_DIR, epicFiles]] as const) {
      for (const f of list) {
        const tf = parseTicketFile(join(dir, f), relative(repoRoot, join(dir, f)));
        if (tf) files.push(tf);
      }
    }
    return files;
  };

  const ticketFiles: TicketFile[] = scanTicketFiles();

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

  // Importable is the one category that INVERTS on an unreadable registry:
  // an empty map is indistinguishable from a missing tool, so plan-only
  // files must not be reported (nor trigger the --fix refusal below) when
  // the registry state is unknown. Issue-derived categories are naturally
  // empty in that case and need no gating.
  if (!gitIssuesAvailable) {
    report.importableTickets = [];
  }

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

  // ── Issue-lifecycle drift (import / foreign / move) ──────────

  if (report.importableTickets.length > 0) {
    raw(`\n🟡 Importable tickets (.md, no git issue): ${report.importableTickets.length}`);
    for (const m of report.importableTickets.slice(0, verbose ? Infinity : 10)) {
      raw(`   ${m.extid}: ${m.source}`);
    }
    if (!verbose && report.importableTickets.length > 10) {
      raw(`   ... and ${report.importableTickets.length - 10} more`);
    }
    raw(`   → rerun with --fix --import to create the missing issues`);
  } else {
    raw(`\n🟢 No importable tickets`);
  }

  if (report.titleDrifts.length > 0) {
    raw(`\n🔴 Title drift (issue extid ≠ ticket extid, slug match): ${report.titleDrifts.length}`);
    for (const m of report.titleDrifts) {
      raw(`   ${m.extid}: issue ${m.hash} still "${m.issueExtid}"`);
    }
  } else {
    raw(`\n🟢 No title drift`);
  }

  if (report.mdStatusStale.length > 0) {
    raw(`\n🟡 .md status stale (index authoritative): ${report.mdStatusStale.length}`);
    for (const m of report.mdStatusStale) {
      raw(`   ${m.extid}: .md="${m.mdStatus}" → ${m.indexStatus}`);
    }
  } else {
    raw(`\n🟢 No stale .md statuses`);
  }

  if (report.indexStatusStale.length > 0) {
    raw(
      `\n🟡 Index status lags an appended .md done-marker (fixable): ${report.indexStatusStale.length}`,
    );
    for (const m of report.indexStatusStale) {
      raw(`   ${m.extid}: index="${m.indexStatus}" → done`);
    }
  }

  if (report.foreignIssues.length > 0) {
    raw(
      `\n🟡 Foreign issues (open in registry, no .plan/ reflection): ${report.foreignIssues.length}`,
    );
    for (const m of report.foreignIssues.slice(0, verbose ? Infinity : 10)) {
      raw(`   ${m.hash} ${m.extid}: ${m.title.slice(0, 60)}`);
    }
    if (!verbose && report.foreignIssues.length > 10) {
      raw(`   ... and ${report.foreignIssues.length - 10} more`);
    }
    raw(`   → import manually or rerun --fix --import-back`);
  } else {
    raw(`\n🟢 No foreign issues`);
  }

  if (report.foreignUnparsedIssues.length > 0) {
    raw(
      `\n🟡 Foreign issues without TYPE-extid (manual only): ${report.foreignUnparsedIssues.length}`,
    );
    for (const m of report.foreignUnparsedIssues.slice(0, verbose ? Infinity : 10)) {
      raw(`   ${m.hash}: ${m.title.slice(0, 60)}`);
    }
    if (!verbose && report.foreignUnparsedIssues.length > 10) {
      raw(`   ... and ${report.foreignUnparsedIssues.length - 10} more`);
    }
  } else {
    raw(`\n🟢 No unparsed foreign issues`);
  }

  if (report.duplicateOpenIssues.length > 0) {
    raw(`\n🟡 Duplicate open issues (manual dedupe): ${report.duplicateOpenIssues.length}`);
    for (const m of report.duplicateOpenIssues) {
      raw(`   ${m.extid}: ${m.hashes.join(", ")}`);
    }
  } else {
    raw(`\n🟢 No duplicate open issues`);
  }

  if (report.danglingMdRefs.length > 0) {
    raw(`\n🟡 Dangling .md issue refs (hash not in registry): ${report.danglingMdRefs.length}`);
    for (const m of report.danglingMdRefs) {
      raw(`   ${m.extid}: git issue: ${m.hash}`);
    }
  } else {
    raw(`\n🟢 No dangling .md refs`);
  }

  // Advisory: non-epic tickets not bound to any epic. Deliberately not
  // counted in totalIssues or advisoryCount — a count in advisoryCount would
  // trigger gratuitous --fix index rewrites on every run.
  if (report.unboundEpics.length > 0) {
    raw(`\n🟡 Unbound to epic (advisory, non-gating): ${report.unboundEpics.length}`);
    if (verbose) {
      report.unboundEpics.forEach((extid) => raw(`   ${extid}`));
    } else {
      report.unboundEpics.slice(0, 10).forEach((extid) => raw(`   ${extid}`));
      if (report.unboundEpics.length > 10) {
        raw(`   ... and ${report.unboundEpics.length - 10} more`);
      }
    }
  } else {
    raw(`\n🟢 All non-epic tickets bound to an epic`);
  }

  // Summary — only *actionable* issues gate the result. Placeholder hashes,
  // missing-hash suggestions, missing git_issue links, and orphan git issues
  // are advisory (yellow), not failures.  Stale open git issues are actionable.
  const totalIssues = report.orphanFiles.length
    + report.phantomEntries.length
    + report.hashMismatches.length
    + report.statusMismatches.length
    + report.staleOpenGitIssues.length
    + report.titleDrifts.length
    + report.mdStatusStale.length
    + report.indexStatusStale.length;
  const advisoryCount = report.placeholderHashes.length
    + report.missingHashes.length
    + report.missingGitIssueLinks.length
    + report.orphanGitIssues.length
    + report.importableTickets.length
    + report.foreignIssues.length
    + report.foreignUnparsedIssues.length
    + report.duplicateOpenIssues.length
    + report.danglingMdRefs.length;

  raw(`\n${"═".repeat(60)}`);

  // Apply fixes (also when only advisory issues exist — e.g. missing-hash
  // links, or a pending status backfill that no other category surfaces).
  const backfillPending = ticketFiles.some(
    (tf) => index[tf.filename.replace(/\.md$/, "").toUpperCase()]?.status === undefined,
  );
  if (fixMode && (totalIssues > 0 || advisoryCount > 0 || backfillPending)) {
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

    // Recompute reconciliation on the *fixed* index so the summary reflects
    // the resolved state (e.g. placeholder hashes now linked, not still
    // advisory). The registry is re-read too: import/rename fixes changed
    // it, and a stale map would re-report resolved tickets as importable.
    const refreshed = readGitIssues(repoRoot);
    const postGitIssues = refreshed.available ? refreshed.issues : gitIssues;
    // Re-scan .md files too: fixes may have rewritten Status lines or
    // generated import-back files; reconciling against stale in-memory
    // copies would re-report what the fix just resolved.
    const postTicketFiles = scanTicketFiles();
    const postReport = reconcile(postTicketFiles, postGitIssues, fixedIndex, verbose, repoRoot);
    const postTotal = postReport.orphanFiles.length
      + postReport.phantomEntries.length
      + postReport.hashMismatches.length
      + postReport.statusMismatches.length
      + postReport.staleOpenGitIssues.length
      + postReport.titleDrifts.length
      + postReport.mdStatusStale.length
      + postReport.indexStatusStale.length;
    const postAdvisory = postReport.placeholderHashes.length
      + postReport.missingHashes.length
      + postReport.missingGitIssueLinks.length
      + postReport.orphanGitIssues.length
      + postReport.importableTickets.length
      + postReport.foreignIssues.length
      + postReport.foreignUnparsedIssues.length
      + postReport.duplicateOpenIssues.length
      + postReport.danglingMdRefs.length;

    if (postTotal === 0) {
      raw(`Index is in sync${postAdvisory > 0 ? ` (${postAdvisory} advisory remaining)` : ""}`);
    } else {
      raw(
        `${postTotal} actionable issue(s) remain${
          postAdvisory > 0 ? `, ${postAdvisory} advisory` : ""
        }`,
      );
    }
    opts.onSummary?.({
      tickets: ticketFiles.length,
      fixesApplied: report.fixesApplied.length,
      issuesRemaining: postTotal,
      advisoryRemaining: postAdvisory,
    });
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

  opts.onSummary?.({
    tickets: ticketFiles.length,
    fixesApplied: 0,
    issuesRemaining: totalIssues,
    advisoryRemaining: advisoryCount,
  });

  // Exit code
  return totalIssues > 0 ? 1 : 0;
}
