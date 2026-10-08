// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Git plumbing shared by the history family (`giwt history audit`,
 * `giwt history skips`, and the rebase skip ledger): commit walks plus
 * stable patch-id batches.
 *
 * Patch-ids are computed exactly the way `git rebase` detects
 * already-upstream commits: one `git diff-tree --stdin -p --root -r`
 * batch fed to `git patch-id --stable`. `--stable` canonicalizes hunk
 * offsets and whitespace, so a cherry-pick whose context shifted still
 * produces the SAME id (probed: a context-shifted duplicate matches),
 * while `--root` keeps root commits of unrelated histories visible.
 *
 * A non-merge commit ABSENT from the patch-id output has an empty diff
 * against its parent — that is the `empty-commit` detector's signal, and
 * it costs nothing extra: the same batch answers both questions.
 */

import { isolatedGitEnv } from "../utils/git";

/** One commit of a walked range, oldest first (replay order). */
export interface CommitInfo {
  sha: string;
  subject: string;
  /** Parent shas; [] for a root commit, 2+ marks a merge. */
  parents: string[];
  /** Stable patch-id, or null when the commit has no diff (empty). */
  patchId: string | null;
}

/** Run git in `root`; throws with stderr when the exit is unexpected. */
export function historyGit(
  root: string,
  args: string[],
  opts: { input?: string; okCodes?: number[]; } = {},
): { out: string; code: number; err: string; } {
  const result = Bun.spawnSync(["git", "-C", root, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: opts.input === undefined ? "ignore" : new TextEncoder().encode(opts.input),
    env: isolatedGitEnv(),
  });
  const out = result.stdout.toString();
  const err = result.stderr.toString();
  if (result.exitCode !== 0 && !(opts.okCodes ?? []).includes(result.exitCode)) {
    throw new Error(`git ${args.join(" ")} failed: ${err.trim() || out.trim()}`);
  }
  return { out, code: result.exitCode, err };
}

/** Parse `git patch-id --stable` output into sha → patch-id. */
function parsePatchIds(out: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of out.split("\n")) {
    const [patchId, sha] = line.trim().split(/\s+/);
    if (patchId !== undefined && /^[0-9a-f]{40}$/.test(sha ?? "")) map.set(sha!, patchId);
  }
  return map;
}

/** Stable patch-ids for a set of commits, one `diff-tree` batch. */
export function batchPatchIds(root: string, shas: string[]): Map<string, string> {
  if (shas.length === 0) return new Map();
  const patch = historyGit(root, ["diff-tree", "--stdin", "-p", "--root", "-r"], {
    input: `${shas.join("\n")}\n`,
  });
  return parsePatchIds(historyGit(root, ["patch-id", "--stable"], { input: patch.out }).out);
}

/**
 * Walk `range` (any `git log` revision range) in replay order:
 * `--topo-order --reverse` — the order a rebase would replay commits.
 * Merge commits are included unless `noMerges`; each commit carries its
 * stable patch-id (null when the diff is empty).
 */
export function walkRange(
  opts: { root: string; range: string; noMerges?: boolean; withPatchIds?: boolean; },
): CommitInfo[] {
  const { root, range } = opts;
  const log = historyGit(root, [
    "log",
    "--topo-order",
    "--reverse",
    ...(opts.noMerges ? ["--no-merges"] : []),
    "--format=%H%x1f%P%x1f%s",
    range,
  ]).out;
  const commits: CommitInfo[] = [];
  for (const line of log.split("\n")) {
    if (line === "") continue;
    const [sha, parents, subject] = line.split("\x1f");
    if (sha === undefined || subject === undefined) continue;
    commits.push({
      sha,
      parents: parents === undefined || parents === "" ? [] : parents.split(" "),
      subject,
      patchId: null,
    });
  }
  if (opts.withPatchIds !== false && commits.length > 0) {
    const pids = batchPatchIds(
      root,
      commits.filter((c) => c.parents.length < 2).map((c) => c.sha),
    );
    for (const commit of commits) commit.patchId = pids.get(commit.sha) ?? null;
  }
  return commits;
}

/**
 * patch-id → twin commit shas for everything reachable from `ref`
 * (non-merge commits only; merges carry no patch of their own).
 */
export function targetPatchIds(root: string, ref: string): Map<string, string[]> {
  const shas = historyGit(root, ["rev-list", "--no-merges", "--topo-order", "--reverse", ref])
    .out.split("\n").map((l) => l.trim()).filter(Boolean);
  const byPid = new Map<string, string[]>();
  for (const [sha, pid] of batchPatchIds(root, shas)) {
    const twins = byPid.get(pid);
    if (twins === undefined) byPid.set(pid, [sha]);
    else twins.push(sha);
  }
  return byPid;
}
