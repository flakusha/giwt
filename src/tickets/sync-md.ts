// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

// ── .md writers (provenance stamps, issue refs) ───────────────

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { isolatedGitEnv } from "../utils/git";

/**
 * Provenance line for a registry-driven Done stamp
 * (BUG-sync-fix-stamps-ticket-done-without-provenance): the git-issue close
 * event is (at minimum) the tip commit of the issue's ref
 * (`refs/issues/<uuid>` — the uuid is prefixed by the issue hash), so the
 * short sha + author recorded there name the agent that flipped the shared
 * registry state. A reader of any worktree commit can then distinguish a
 * registry-driven Done from a locally verified one. Best-effort: a missing
 * ref or unreadable metadata degrades to a plainer line, never throws.
 */
export function registryDoneProvenance(repoRoot: string, hash: string | undefined): string {
  const stamp = `**Resolved:** ${new Date().toISOString().slice(0, 10)} registry-driven close`;
  if (!hash || !/^[0-9a-f]{7,40}$/.test(hash)) return `${stamp}: git issue hash unknown`;
  const gitOpts = {
    timeout: 10_000,
    cwd: repoRoot,
    env: isolatedGitEnv(),
    encoding: "utf8",
  } as const;
  try {
    const ref = execFileSync(
      "git",
      ["for-each-ref", "--format=%(refname)", `refs/issues/${hash}*`],
      gitOpts,
    ).trim().split("\n")[0];
    if (!ref) return `${stamp}: git issue ${hash} (issue ref not found)`;
    const tip = execFileSync("git", ["log", "-1", "--format=%h %an %s", ref], gitOpts).trim();
    return `${stamp}: git issue ${hash} (registry tip: ${tip.slice(0, 100)})`;
  } catch {
    return `${stamp}: git issue ${hash} (registry metadata unavailable)`;
  }
}

/** Append the provenance line to a .md sync just stamped Done, unless the
 * file already carries a `**Resolved:**` line (`giwt ticket close` output
 * and prior runs are preserved — idempotent re-runs never double-stamp). */
export function appendRegistryDoneProvenance(
  tfPath: string,
  repoRoot: string,
  hash: string | undefined,
): void {
  const text = readFileSync(tfPath, "utf8");
  if (/\*\*Resolved:\*\*/.test(text)) return;
  writeFileSync(
    tfPath,
    `${text.replace(/\n+$/, "\n")}\n${registryDoneProvenance(repoRoot, hash)}\n`,
  );
}

// ── Entry ─────────────────────────────────────────────────────

/**
 * Point a ticket .md's `git issue:` reference at `hash` — replacing an
 * existing reference line or appending one past the header region.
 */
export function appendIssueRef(mdPath: string, hash: string): void {
  let text = readFileSync(mdPath, "utf8");
  if (/(?:git.?issue|issue):\s*[0-9a-f]{7,}/i.test(text)) {
    text = text.replace(/(?:git.?issue|issue):\s*[0-9a-f]{7,}/i, `git issue: ${hash}`);
  } else {
    text = text.replace(/(\n---\n|$)/, `\n\ngit issue: ${hash}\n`);
  }
  writeFileSync(mdPath, text);
}
