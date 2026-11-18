// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Pijul-mode history audit. Pijul changes carry immutable intrinsic ids, so
 * the only true "already applied" signal is the same change hash appearing
 * in both the branch and target channel histories. Git-only detectors are
 * reported as inapplicable rather than forced onto a change-hash history.
 */

import { changeHashes, defaultPijulSpawn, type PijulSpawn } from "../vcs/pijul";

/** Local mirror of AuditFinding's shape; FindingReason has no pijul reason yet. */
interface PijulFinding {
  reason: "duplicate-change-hash";
  sha: string;
  subject: string;
  patchId: null;
  evidence: string;
  twins?: string[];
}

const INAPPLICABLE = [
  "empty-commit: pijul records always carry a change; no git-style empty commit",
  "merge-in-range: pijul channels are change DAGs, not git merge commits",
  "duplicate-rename-insensitive: pijul change ids are already rename-insensitive",
];

/** Read one channel's intrinsic change hashes, failing closed on bad output. */
function channelHashes({ spawn, root, channel }: {
  spawn: PijulSpawn;
  root: string;
  channel: string;
}): Set<string> {
  const result = spawn(
    ["pijul", "log", "--hash-only", "--output-format", "json", "--channel", channel],
    root,
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `pijul log --channel ${channel} failed (exit ${result.exitCode}): ${result.stderr.trim()}`,
    );
  }
  const out = result.stdout.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(out);
  } catch {
    throw new Error(
      `pijul log --channel ${channel}: unparseable JSON output: ${out.slice(0, 120)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`pijul log --channel ${channel}: expected a JSON array of changes`);
  }
  const hashes = changeHashes(out);
  if (parsed.length > 0 && hashes.size === 0) {
    throw new Error(`pijul log --channel ${channel}: no change hashes in log output`);
  }
  return hashes;
}

/**
 * Audit branch against target over pijul change-hash history.
 * Read-only: two `pijul log` calls, no mutation and no git spawn.
 */
export function auditPijulHistory({
  root,
  branch,
  target,
  spawn = defaultPijulSpawn,
}: {
  root: string;
  branch: string;
  target: string;
  spawn?: PijulSpawn;
}): { branch: string; target: string; findings: PijulFinding[]; inapplicable: string[]; } {
  const branchHashes = channelHashes({ spawn, root, channel: branch });
  const targetHashes = channelHashes({ spawn, root, channel: target });
  const shared = [...branchHashes].filter((hash) => targetHashes.has(hash)).sort();
  const findings: PijulFinding[] = shared.map((hash): PijulFinding => ({
    reason: "duplicate-change-hash",
    sha: hash,
    subject: hash,
    patchId: null,
    twins: [hash],
    evidence:
      `pijul change ${hash} is present in both ${branch} and ${target}; change ids are immutable, so replaying ${branch} onto ${target} would apply the same change twice`,
  }));
  return { branch, target, findings, inapplicable: [...INAPPLICABLE] };
}
