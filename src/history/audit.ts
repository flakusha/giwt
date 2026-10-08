// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt history audit` — classify the shape of `<onto>..<branch>` and
 * flag SUSPICIOUS commits before a rebase replays them.
 *
 * ── Detector seam ─────────────────────────────────────────────────
 * A detector is a pure function from shared walk data to findings; the
 * DETECTORS record below is the registry. Landing a later detector from
 * the audit umbrella (rename-normalized fingerprint match, resurrected
 * files, weave damage) means: give it a FindingReason key, append one
 * entry to DETECTORS, and the grouping, cap, JSON shape, and gate exit
 * code pick it up with no other change. Detectors MUST stay read-only
 * (no git mutation) and return findings in replay order.
 */

import { type AuditLinearity } from "../utils/settings";
import { type CommitInfo, historyGit, targetPatchIds, walkRange } from "./patch-ids";

export type FindingReason = "duplicate-patch-id" | "empty-commit" | "merge-in-range";

export interface AuditFinding {
  reason: FindingReason;
  sha: string;
  subject: string;
  patchId: string | null;
  /** Accept/reject evidence: how to verify the finding by hand. */
  evidence: string;
  /** Target-history commits carrying the same patch-id (the twins). */
  twins?: string[];
}

export interface HistoryShape {
  /** No merge commits in range. */
  linear: boolean;
  /** Commits in range, merges included. */
  commits: number;
  merges: number;
  /** Merges with 3+ parents. */
  octopus: number;
  mergeBases: string[];
  crissCross: boolean;
  /** Configured [audit] linearity. */
  mode: AuditLinearity;
  /** auto resolved by target history: merges allowed or not. */
  effective: "require-linear" | "allow-merges";
  verdict: "linear" | "merges-allowed" | "merge-violation";
}

export interface AuditReport {
  v: 1;
  branch: string;
  onto: string;
  range: string;
  shape: HistoryShape;
  /** Findings grouped by reason, capped at [audit] max_findings. */
  findings: Partial<Record<FindingReason, AuditFinding[]>>;
  /** Pre-cap total, present ONLY when the cap truncated (doctor cap
   * semantics — a capped report must never read as complete). */
  findingsTotal?: number;
  exit: 0 | 1;
}

export interface DetectorInput {
  root: string;
  onto: string;
  /** Range commits in replay order, merges included. */
  commits: CommitInfo[];
  /** patch-id → target twin shas; null when [audit] patch_ids = false. */
  targetPids: Map<string, string[]> | null;
  effective: "require-linear" | "allow-merges";
}

export type Detector = (input: DetectorInput) => AuditFinding[];

/** Commit's stable patch-id is already present in the target history. */
const duplicatePatchIds: Detector = ({ commits, targetPids }) => {
  if (targetPids === null) return [];
  const findings: AuditFinding[] = [];
  for (const commit of commits) {
    if (commit.parents.length > 1 || commit.patchId === null) continue;
    const twins = targetPids.get(commit.patchId);
    if (twins === undefined) continue;
    findings.push({
      reason: "duplicate-patch-id",
      sha: commit.sha,
      subject: commit.subject,
      patchId: commit.patchId,
      twins,
      evidence: `git show ${
        twins[0]
      } — same stable patch-id ${commit.patchId}; a rebase would silently skip ${
        commit.sha.slice(0, 7)
      }`,
    });
  }
  return findings;
};

/** Non-merge commit with no diff against its parent. */
const emptyCommits: Detector = ({ commits }) =>
  commits
    .filter((c) => c.parents.length < 2 && c.patchId === null)
    .map((commit) => ({
      reason: "empty-commit" as const,
      sha: commit.sha,
      subject: commit.subject,
      patchId: null,
      evidence: `git diff-tree -p ${commit.sha} is empty — carries intent (message), not change`,
    }));

/** Merge commits in range while the effective policy requires linear. */
const mergesInRange: Detector = ({ commits, effective }) =>
  effective === "allow-merges"
    ? []
    : commits
      .filter((c) => c.parents.length > 1)
      .map((commit) => ({
        reason: "merge-in-range" as const,
        sha: commit.sha,
        subject: commit.subject,
        patchId: null,
        evidence:
          `git log --format='%P' -1 ${commit.sha} lists ${commit.parents.length} parents; policy requires a linear range`,
      }));

/** Static registry — the seam later audit detectors append to. */
export const DETECTORS: Record<FindingReason, Detector> = {
  "duplicate-patch-id": duplicatePatchIds,
  "empty-commit": emptyCommits,
  "merge-in-range": mergesInRange,
};

const REASON_ORDER: Record<FindingReason, true> = {
  "duplicate-patch-id": true,
  "empty-commit": true,
  "merge-in-range": true,
};

export function verifyRef(root: string, ref: string): void {
  historyGit({ root, args: ["rev-parse", "--verify", `${ref}^{commit}`], okCodes: [] });
}

/** All merge bases of the two refs (criss-cross ⇒ more than one). */
function mergeBases({ root, onto, branch }: {
  root: string;
  onto: string;
  branch: string;
}): string[] {
  // Exit 1 with empty output = no common ancestor (unrelated histories).
  return historyGit({ root, args: ["merge-base", "--all", onto, branch], okCodes: [1] })
    .out.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** True when the target's own history contains merge commits. */
function targetHasMerges(root: string, onto: string): boolean {
  return historyGit({ root, args: ["rev-list", "--merges", "-n", "1", onto] }).out.trim() !== "";
}

/**
 * Audit `<onto>..<branch>`: shape classification + suspicious findings.
 * Pure with respect to the working tree (read-only git), throws on bad
 * refs so the caller surfaces a clean error.
 */
export function auditHistory(
  opts: {
    root: string;
    branch: string;
    onto: string;
    linearity: AuditLinearity;
    patchIds: boolean;
    maxFindings: number;
  },
): AuditReport {
  const { root, branch, onto } = opts;
  verifyRef(root, branch);
  verifyRef(root, onto);

  const commits = walkRange({ root, range: `${onto}..${branch}` });
  const bases = mergeBases({ root, onto, branch });
  const merges = commits.filter((c) => c.parents.length > 1);
  const octopus = merges.filter((c) => c.parents.length > 2).length;
  const effective = opts.linearity === "auto"
    ? targetHasMerges(root, onto) ? "allow-merges" : "require-linear"
    : opts.linearity;
  const linear = merges.length === 0;
  const verdict = linear
    ? "linear"
    : effective === "allow-merges"
    ? "merges-allowed"
    : "merge-violation";
  const shape: HistoryShape = {
    linear,
    commits: commits.length,
    merges: merges.length,
    octopus,
    mergeBases: bases,
    crissCross: bases.length > 1,
    mode: opts.linearity,
    effective,
    verdict,
  };

  const targetPids = opts.patchIds ? targetPatchIds(root, onto) : null;
  const input: DetectorInput = { root, onto, commits, targetPids, effective };
  const flat: AuditFinding[] = [];
  for (const reason of Object.keys(REASON_ORDER) as FindingReason[]) {
    flat.push(...DETECTORS[reason](input));
  }

  const cap = Math.max(0, opts.maxFindings);
  const kept = flat.slice(0, cap);
  const findings: Partial<Record<FindingReason, AuditFinding[]>> = {};
  for (const finding of kept) {
    const group = findings[finding.reason];
    if (group === undefined) findings[finding.reason] = [finding];
    else group.push(finding);
  }
  return {
    v: 1,
    branch,
    onto,
    range: `${onto}..${branch}`,
    shape,
    findings,
    ...(flat.length > cap ? { findingsTotal: flat.length } : {}),
    exit: flat.length > 0 ? 1 : 0,
  };
}
