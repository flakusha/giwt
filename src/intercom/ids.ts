// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Project identity keying for the intercom store (DESIGN §3).
 *
 * Key = normalized `git config --get remote.origin.url` (credentials
 * stripped) when a remote exists, else sha256 of the realpath of
 * `git rev-parse --git-common-dir` (repoRoot-anchored: every worktree of
 * one repo computes the same key). Store dir = human slug + hash[0..16]
 * (`giwt-3f9c1a…`) — readable in `ls ~/.local/state/giwt/intercom/` while
 * staying collision-safe.
 *
 * A repo move/rename re-keys (path-keyed stores orphan; `giwt intercom gc`
 * sweeps them); remote-keyed stores survive moves and share across clones
 * of one URL on this host (same tradeoff check-slots accepted).
 */

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { gitSyncQuiet } from "../utils/git";

/** Hash width of the store-dir suffix. 16 hex chars = 64 bits — collision
 *  odds are negligible at any plausible store count on one host. */
const HASH_LEN = 16;

/** A resolved project identity: `dirName` is the store directory name. */
export interface ProjectIdentity {
  /** Normalized remote URL, or `path:<realpath>` for local-only repos. */
  key: string;
  /** Which keying rule produced the key. */
  kind: "url" | "path";
  /** Human-readable slug (from the URL's last segment or the repo dir). */
  slug: string;
  /** Full sha256 hex of the key. */
  hash: string;
  /** Store directory name: `<slug>-<hash[0..16]>`. */
  dirName: string;
  /** The realpath used for path-kind keys and drift checks (undefined for
   *  url-keyed stores). */
  repoPath?: string;
}

/**
 * Normalize a remote URL into a stable key: strip credentials
 * (`user:pass@` / scp-like `git@host:`), trailing `.git` and slashes.
 * Local filesystem remotes pass through as-is (they key like paths).
 */
export function normalizeRemoteUrl(raw: string): string {
  let url = raw.trim();
  // scp-like: git@host:owner/repo.git → ssh://host/owner/repo.git
  const scp = /^([^/@]+)@([^/:]+):(.+)$/.exec(url);
  if (scp) url = `ssh://${scp[2]}/${scp[3]}`;
  // scheme://user:pass@host/… → scheme://host/…
  url = url.replace(/^(\w+:\/\/)[^/@]+@/, "$1");
  url = url.replace(/\/+$/, "").replace(/\.git$/, "").replace(/\/+$/, "");
  return url;
}

/** Sanitize a human slug: lowercase, keep [a-z0-9._-], collapse the rest to
 *  dashes, cap length. Never empty — falls back to "repo". */
export function slugify(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "repo";
}

function hashOf(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Compute the project identity for a repo checkout. `repoRoot` is giwt's
 * resolved main-checkout root (from `git rev-parse --git-common-dir`, so
 * worktrees land on the same identity as the root checkout).
 */
export function projectIdentity(repoRoot: string): ProjectIdentity {
  const remote = gitSyncQuiet(repoRoot, "config", "--get", "remote.origin.url").trim();
  const commonDir = realpathSync(gitCommonDirAbs(repoRoot));
  if (remote.length > 0) {
    const key = normalizeRemoteUrl(remote);
    const hash = hashOf(key);
    const last = key.split("/").filter(Boolean).at(-1) ?? basename(commonDir);
    return {
      key,
      kind: "url",
      slug: slugify(last),
      hash,
      dirName: `${slugify(last)}-${hash.slice(0, HASH_LEN)}`,
    };
  }
  // No remote (giwt itself has none): key on the repo's realpath. Every
  // worktree of the repo shares --git-common-dir, so the key matches from
  // any checkout.
  const key = `path:${commonDir}`;
  const hash = hashOf(key);
  const slug = slugify(
    basename(commonDir) === ".git" ? basename(dirname(commonDir)) : basename(commonDir),
  );
  return {
    key,
    kind: "path",
    slug,
    hash,
    dirName: `${slug}-${hash.slice(0, HASH_LEN)}`,
    repoPath: commonDir,
  };
}

/** Absolute `--git-common-dir` for a checkout (relative output resolves
 *  against the checkout, matching `findRepoRoot`). Exported for tests. */
export function gitCommonDirAbs(repoRoot: string): string {
  const raw = gitSyncQuiet(repoRoot, "rev-parse", "--git-common-dir").trim();
  if (raw.length === 0) {
    throw new Error(`intercom: not a git repository (root: ${repoRoot})`);
  }
  return resolve(repoRoot, raw);
}

/** Agent identity for claim files + events: GIWT_AGENT ?? `host:pid` —
 *  the ledger convention, so both evidence surfaces agree on who wrote. */
export function agentIdentity(): string {
  return process.env.GIWT_AGENT ?? `${hostname()}:${process.pid}`;
}
