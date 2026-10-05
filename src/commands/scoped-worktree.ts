// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
// size-allow: 300

/**
 * Scoped worktree creation (`giwt new --scope <text> --tickets <csv>`).
 *
 * Copy semantics (design review 2026-10-01): resolved ticket .md files are
 * copied into the new worktree with Status rewritten to `In Progress` and an
 * optional `**Scope:**` header line, then committed as the worktree's first
 * commit. Master-side copies stay untouched. Scope metadata persists in the
 * worktree's git dir (`<gitdir>/giwt-scoped.json`) so `giwt finalize` can
 * run the pre-merge ticket close and the post-merge plan reconciliation
 * (finalize Step 5.5) without extra flags.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { buildMap, writeMap } from "../plan/code-map";
import { genMatrix } from "../plan/feature-matrix";
import { runSync, STATUS_LINE_RE } from "../tickets/sync-index";
import { assertGitAuthorIdentity } from "../utils/author-guard";
import { type WorktreeConfig } from "../utils/config";
import { gitSync, gitSyncQuiet, isolatedGitEnv } from "../utils/git";
import { log } from "../utils/output";
import { extidForHash, resolveExtid } from "./resolver";

export interface ScopedMeta {
  /** Uppercase extids of the scoped tickets. */
  tickets: string[];
  /** Short explanation carried as the `**Scope:**` header line. */
  scope?: string;
}

const MARKER_NAME = "giwt-scoped.json";

/** Absolute path of the linked worktree's git dir (where the marker lives). */
function scopedMarkerPath(wtPath: string): string {
  return join(gitSyncQuiet(wtPath, "rev-parse", "--git-dir"), MARKER_NAME);
}

export function readScopedMeta(wtPath: string): ScopedMeta | null {
  const p = scopedMarkerPath(wtPath);
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8")) as ScopedMeta;
    return Array.isArray(parsed.tickets) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeScopedMeta(wtPath: string, meta: ScopedMeta): void {
  writeFileSync(scopedMarkerPath(wtPath), `${JSON.stringify(meta, null, 2)}\n`);
}

export interface ParsedScopeArgs {
  scope?: string;
  tickets?: string[];
  /** Remaining positional args (branch, base, ...). */
  rest: string[];
}

/**
 * Strip `--scope <text>` / `--tickets <csv>` from raw args. Flags may
 * precede or follow positionals. Exits 1 on an unknown flag or a missing
 * value — parse errors fire before any git mutation.
 */
export function parseScopeFlags(args: string[]): ParsedScopeArgs {
  const rest: string[] = [];
  let scope: string | undefined;
  let tickets: string[] | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--scope") {
      const v = args[i + 1];
      if (v === undefined || v.startsWith("--")) {
        log("error", "--scope requires a short explanation argument");
        process.exit(1);
      }
      scope = v;
      i++;
    } else if (a === "--tickets") {
      const v = args[i + 1];
      if (v === undefined || v.startsWith("--")) {
        log("error", "--tickets requires a comma-separated id list");
        process.exit(1);
      }
      tickets = v.split(",").map((t) => t.trim()).filter(Boolean);
      if (tickets.length === 0) {
        log("error", "--tickets given but no ticket ids resolved from the csv");
        process.exit(1);
      }
      i++;
    } else if (a.startsWith("--") && a !== "--") {
      log("error", `unknown flag '${a}'`);
      process.exit(1);
    } else {
      rest.push(a);
    }
  }
  return {
    ...(scope !== undefined ? { scope } : {}),
    ...(tickets !== undefined ? { tickets } : {}),
    rest,
  };
}

interface ScopedTicket {
  extid: string;
  /** Absolute path of the master-side .md. */
  path: string;
  filename: string;
}

/** Resolve ticket ids (extid, filename slug, slug.md, or the git-issue
 * hash — BUG-ticket-id-inputs-) against the managed plan tickets dir.
 * Unmatched ids are a hard error — before worktree add. */
export function resolveScopedTickets(config: WorktreeConfig, ids: string[]): ScopedTicket[] {
  const dir = resolve(config.worktreeRoot, config.settings.paths.tickets);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")) : [];
  const out: ScopedTicket[] = [];
  for (const id of ids) {
    const bare = id.replace(/\.md$/i, "").toLowerCase();
    const found = files.find((f) => f.replace(/\.md$/i, "").toLowerCase() === bare);
    // Hash fallback (BUG-ticket-id-inputs-): resolve the pasted git-issue
    // hash to its title extid, then match the file by the same
    // extid↔slug convention the filename pass uses.
    let hashed: string | undefined;
    if (!found) {
      const extid = extidForHash(config.repoRoot, id);
      hashed = extid
        ? files.find((f) => f.replace(/\.md$/i, "").toUpperCase() === extid.toUpperCase())
        : undefined;
    }
    if (!found && !hashed) {
      log("error", `unknown ticket id '${id}' (no match in ${dir})`);
      process.exit(1);
    }
    // Extid convention: the filename slug uppercased is the registry extid
    // (sync-index derives index keys the same way).
    const matched = found ?? hashed!;
    out.push({
      extid: matched.replace(/\.md$/i, "").toUpperCase(),
      path: join(dir, matched),
      filename: matched,
    });
  }
  return out;
}

/** Rewrite every header-region Status line (first 30 lines — same field
 * region parseTicketFile trusts) to the given canonical value. Same line
 * shape as sync-index's fix writers so bold-colon variants survive. */
function rewriteStatuses(text: string, target: string): string {
  const lines = text.split("\n");
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    if (STATUS_LINE_RE.test(lines[i]!)) {
      lines[i] = lines[i]!.replace(
        /^((?:\*\*)?\s*status\s*(?:\*\*)?\s*[:=]\s*(?:\*\*)?\s*).*$/i,
        `$1${target}`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * Copy the scoped tickets into the fresh worktree with `In Progress`
 * statuses, persist the marker, and land them as the worktree's first
 * commit. Master-side .md files are never touched.
 */
export function applyScopedTickets(
  config: WorktreeConfig,
  wtPath: string,
  scope: string | undefined,
  ticketIds: string[],
): void {
  const tickets = resolveScopedTickets(config, ticketIds);
  const ticketsDir = join(wtPath, config.settings.paths.tickets);
  mkdirSync(ticketsDir, { recursive: true });
  for (const t of tickets) {
    let text = readFileSync(t.path, "utf8");
    text = rewriteStatuses(text, "In Progress");
    if (scope !== undefined && !/\*\*Scope:\*\*/i.test(text)) {
      const lines = text.split("\n");
      const statusIdx = lines.findIndex((l, i) => i < 30 && STATUS_LINE_RE.test(l));
      lines.splice(statusIdx >= 0 ? statusIdx + 1 : 0, 0, `**Scope:** ${scope}`);
      text = lines.join("\n");
    }
    writeFileSync(join(ticketsDir, basename(t.path)), text);
  }
  writeScopedMeta(wtPath, {
    tickets: tickets.map((t) => t.extid),
    ...(scope !== undefined ? { scope } : {}),
  });
  gitSync(wtPath, "add", "-f", config.settings.paths.tickets);
  // Guard: the scope commit is the worktree's first commit and often unsigned
  // (no agent key) — the author line is its only identity. Env-only override.
  assertGitAuthorIdentity({
    cwd: wtPath,
    expectedEmail: config.agentGpgEmail ?? "",
    args: [],
    source: "scope commit",
  });
  gitSync(
    wtPath,
    "commit",
    "-m",
    `chore(tickets): scope ${tickets.length} ticket(s) into this worktree`,
  );
  log(
    "success",
    `Scoped ${tickets.length} ticket(s) (In Progress${scope ? ` — scope: ${scope}` : ""})`,
  );
}

/**
 * Scoped-worktree pre-merge close: close the ticket issues recorded in the
 * worktree's scope marker on the shared registry BEFORE the merge, so the
 * post-merge Step 5.5 sync pass carries their Done state into the .md files
 * and the index in one movement. Already-closed issues are tolerated
 * (crash-resume reruns land here twice).
 */
export function closeScopedIssues(
  repoRoot: string,
  extids: string[],
): void {
  log("info", `Scoped worktree: closing ${extids.length} ticket issue(s)...`);
  for (const extid of extids) {
    // git issue close takes ids/hashes, not extids — resolve first.
    const resolved = resolveExtid(repoRoot, extid);
    if (resolved === null) {
      log("warn", `could not resolve ${extid} in the registry`);
      continue;
    }
    const closed = Bun.spawnSync(
      ["git", "-C", repoRoot, "issue", "state", resolved.hash, "--close"],
      { env: isolatedGitEnv(), stdout: "pipe", stderr: "pipe" },
    );
    if (closed.exitCode === 0) {
      log("success", `closed ${extid} (${resolved.hash})`);
    } else {
      log("warn", `could not close ${extid} (already closed or registry busy)`);
    }
  }
}

/** -c overrides for the Step 5.5 in-place commit — mirrors finalize's
 * gpgMergeFlags so the reconciliation commit is signed exactly when an
 * agent key is configured (cold-cache repos keep repo-local config). */
export function scopedSignFlags(agentGpgKeyId: string | undefined): string[] {
  return agentGpgKeyId
    ? ["-c", "commit.gpgsign=true", "-c", `user.signingkey=${agentGpgKeyId}`]
    : [];
}

/**
 * Finalize Step 5.5: post-merge plan reconciliation on the target checkout
 * (repoRoot) — for EVERY non-alreadyMerged finalize, not only scoped
 * worktrees (FEAT-universal-post-merge-plan-reconciliation). runSync --fix
 * repairs the merged index/tickets, generated artifacts are regenerated,
 * and the result commits on the target branch. Idempotent: a rerun after a
 * crash finds a consistent tree and skips the commit. No plan dir → no-op.
 */
export function reconcilePlanPostMerge(config: WorktreeConfig, args: string[]): void {
  const planDir = resolve(config.repoRoot, config.settings.paths.planDir);
  if (!existsSync(planDir)) {
    log("info", "Step 5.5: no plan dir — nothing to reconcile");
    return;
  }
  runSync(config.repoRoot, { fix: true, ticketsPath: config.settings.paths.tickets });
  const matrixPath = join(planDir, "feature-matrix.md");
  if (existsSync(matrixPath)) {
    genMatrix(join(planDir, "tickets", "index.json"), matrixPath);
  }
  const mapPath = join(planDir, "code-map.json");
  if (existsSync(mapPath)) {
    writeMap(
      mapPath,
      buildMap(config.repoRoot, [
        { dir: `${config.settings.paths.planDir}/tickets`, kind: "ticket" },
        { dir: `${config.settings.paths.planDir}/epics`, kind: "epic" },
      ]),
    );
  }
  // Stage first: runSync --fix writes to the working tree, so `--cached`
  // only sees the change after the add. A clean stage afterwards means the
  // tree was already consistent (idempotent rerun) — skip the commit.
  gitSync(config.repoRoot, "add", "-f", config.settings.paths.planDir);
  const staged = Bun.spawnSync(
    ["git", "-C", config.repoRoot, "diff", "--cached", "--quiet"],
    { env: isolatedGitEnv(), stdout: "pipe", stderr: "pipe" },
  );
  if (staged.exitCode !== 0) {
    // Guard: the reconciliation commit lands on the target branch from the
    // repoRoot identity — refuse a tampered repo author before committing.
    assertGitAuthorIdentity({
      cwd: config.repoRoot,
      expectedEmail: config.agentGpgEmail ?? "",
      args,
      source: "post-merge reconciliation",
    });
    const signFlags = scopedSignFlags(config.agentGpgKeyId);
    gitSync(
      config.repoRoot,
      ...signFlags,
      "commit",
      "-m",
      "chore(plan): post-merge reconciliation",
    );
    log("success", "Step 5.5: plan reconciliation committed");
  } else {
    log("info", "Step 5.5: plan state already consistent — no commit");
  }
}
