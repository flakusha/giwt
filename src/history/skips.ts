// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Rebase skip ledger — the durable record of every commit a rebase
 * dropped (FEAT-rebase-skip-decisions-are-not-recorded).
 *
 * Storage: `<repoRoot>/<paths.runlog>/skips.jsonl` — the repo runlog
 * area but OUTSIDE runs/, so records survive both `runlog.max_runs`
 * pruning (which only ever deletes run DIRS) and `giwt clean` (whose
 * classes match *.tmp / cov-* / lcov.*.tmp / jscpd / check-report files,
 * never this file) and worktree teardown (records live under repoRoot).
 *
 * A skip is inferred, never parsed from git chatter: the pre-rebase
 * range and the post-rebase range are walked with stable patch-ids and
 * a commit that vanished from the replay — without its patch-id (or,
 * for empty commits, an equal empty subject) surviving — was skipped.
 * This is the same signal `git rebase` uses internally for
 * "skipped previously applied commit", so the ledger and git agree.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { type CommitInfo, historyGit, targetPatchIds } from "./patch-ids";

export type SkipReason = "duplicate" | "empty" | "unexplained";

export interface SkipRecord {
  v: 1;
  ts: string;
  branch: string;
  /** Ref the commit would have applied against (the rebase target). */
  onto: string;
  /** Branch head BEFORE the rebase — recovery pointer to the originals. */
  preHead: string;
  sha: string;
  subject: string;
  patchId: string | null;
  reason: { detected: SkipReason; note?: string; };
  /** Target-history twins carrying the same patch-id (duplicates only). */
  twins?: string[];
}

/** Ledger location: repo runlog area, outside runs/ pruning by design. */
export function skipsPath(config: WorktreeConfig): string {
  return resolve(config.repoRoot, config.settings.paths.runlog, "skips.jsonl");
}

/** Read the ledger in replay order; corrupt lines are skipped. */
export function readSkips(config: WorktreeConfig): SkipRecord[] {
  const path = skipsPath(config);
  if (!existsSync(path)) return [];
  const records: SkipRecord[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      records.push(JSON.parse(line) as SkipRecord);
    } catch { /* corrupt line: keep the readable trail */ }
  }
  return records;
}

function appendSkips(path: string, records: SkipRecord[]): void {
  if (records.length === 0) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

/** One dropped commit, pre-classification. */
export interface DroppedCommit {
  sha: string;
  subject: string;
  patchId: string | null;
  reason: SkipReason;
  twins?: string[];
}

/**
 * Set-diff pre/post replay ranges into dropped commits, in replay order.
 * Kept commits match by patch-id; empty commits (no patch-id) match by
 * an equally-empty subject in the post range — git keeps commits that
 * START empty, so a survivor must not read as a skip.
 */
export function diffSkips(
  opts: {
    pre: CommitInfo[];
    post: CommitInfo[];
    /** patch-id → target twin shas, for duplicate classification. */
    targetPids: Map<string, string[]>;
  },
): DroppedCommit[] {
  const postPids = new Set(opts.post.map((c) => c.patchId).filter((p): p is string => p !== null));
  const emptySubjects = new Map<string, number>();
  for (const commit of opts.post) {
    if (commit.patchId === null) {
      emptySubjects.set(commit.subject, (emptySubjects.get(commit.subject) ?? 0) + 1);
    }
  }
  const dropped: DroppedCommit[] = [];
  for (const commit of opts.pre) {
    if (commit.patchId !== null) {
      if (postPids.has(commit.patchId)) continue;
      const twins = opts.targetPids.get(commit.patchId);
      dropped.push({
        sha: commit.sha,
        subject: commit.subject,
        patchId: commit.patchId,
        reason: twins !== undefined ? "duplicate" : "unexplained",
        ...(twins !== undefined ? { twins } : {}),
      });
      continue;
    }
    const survivors = emptySubjects.get(commit.subject) ?? 0;
    if (survivors > 0) {
      emptySubjects.set(commit.subject, survivors - 1);
      continue;
    }
    dropped.push({ sha: commit.sha, subject: commit.subject, patchId: null, reason: "empty" });
  }
  return dropped;
}

/**
 * Diff a finished rebase and append one record per skipped commit.
 * `pre`/`post` are the replay-order walks of `<target>..HEAD` before
 * and after the rebase; `note` is the operator's --skip-note text.
 * Returns the records written (empty when nothing was skipped).
 */
export function recordRebaseSkips(
  opts: {
    config: WorktreeConfig;
    branch: string;
    target: string;
    preHead: string;
    pre: CommitInfo[];
    post: CommitInfo[];
    note?: string;
  },
): SkipRecord[] {
  const dropped = diffSkips({
    pre: opts.pre,
    post: opts.post,
    targetPids: targetPatchIds(opts.config.repoRoot, opts.target),
  });
  if (dropped.length === 0) return [];
  const ts = new Date().toISOString();
  const records = dropped.map((drop) => ({
    v: 1 as const,
    ts,
    branch: opts.branch,
    onto: opts.target,
    preHead: opts.preHead,
    sha: drop.sha,
    subject: drop.subject,
    patchId: drop.patchId,
    reason: { detected: drop.reason, ...(opts.note !== undefined ? { note: opts.note } : {}) },
    ...(drop.twins !== undefined ? { twins: drop.twins } : {}),
  }));
  appendSkips(skipsPath(opts.config), records);
  return records;
}

/** Comparison-mode verdict for one ledger record. */
export interface SkipVerdict {
  record: SkipRecord;
  justified: boolean;
  /** Verified twin in the compared ref (duplicates). */
  twin?: string;
  /** Why an unjustified skip is probable real-work loss. */
  problem?: string;
}

/**
 * Verify every record against `vs`: a skip is justified ONLY if its
 * duplicate twin (same patch-id) is verifiable in the ref it claimed,
 * or — for empty commits — the original object still diffs empty.
 * Anything else is flagged as probable real-work loss.
 */
export function verifySkips(
  opts: { root: string; records: SkipRecord[]; vs: string; },
): SkipVerdict[] {
  const vsPids = targetPatchIds(opts.root, opts.vs);
  return opts.records.map((record) => {
    if (record.patchId !== null) {
      const twins = vsPids.get(record.patchId);
      if (twins !== undefined && twins[0] !== undefined) {
        return { record, justified: true, twin: twins[0] };
      }
      return {
        record,
        justified: false,
        problem: `patch-id ${record.patchId} not found in '${opts.vs}' — probable real-work loss`,
      };
    }
    // Empty skip: justification is the emptiness itself, re-checked
    // against the original object (reachable via the recorded preHead).
    const exists = historyGit({
      root: opts.root,
      args: ["cat-file", "-e", `${record.sha}^{commit}`],
      okCodes: [128],
    }).code === 0;
    if (!exists) {
      return { record, justified: false, problem: `commit ${record.sha} is gone — unverifiable` };
    }
    const diff = historyGit({ root: opts.root, args: ["diff-tree", "--root", "-p", "-r", record.sha] }).out;
    if (diff.trim() === "") return { record, justified: true };
    return {
      record,
      justified: false,
      problem: `commit ${record.sha} is not empty — drop was wrong`,
    };
  });
}
