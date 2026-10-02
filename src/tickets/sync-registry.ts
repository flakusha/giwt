// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

// ── Read git issues / index.json ──────────────────────────────

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isolatedGitEnv } from "../utils/git";
import { log } from "../utils/output";
import type { GitIssue, IndexEntry } from "./sync-ticket-types";

export interface GitIssueRead {
  issues: Map<string, GitIssue>;
  /** False when the `git issue` listing could not be read (vs genuinely zero issues). */
  available: boolean;
  /** Why the listing failed, when available is false. Message and remedy
   *  differ per class (scan header + --fix refusal below):
   *  - "timeout": CLI present, registry walk exceeded the ceiling.
   *  - "missing": git absent — command-not-found (127) or spawn ENOENT.
   *  - "failed": the CLI ran but exited nonzero — corrupt store, bad args. */
  reason?: "timeout" | "missing" | "failed";
  /** Short failure detail for "failed" (exit status + stderr tail). */
  detail?: string;
}

/** `git issue ls --all` walks the whole registry; large repos (3k+ issues)
 *  exceed 10s, so the ceiling must sit well above registry size, not
 *  process-start latency. */
const ISSUE_LS_TIMEOUT_MS = 60_000;

export function readGitIssues(issuesRoot: string, issueLsTimeoutMs?: number): GitIssueRead {
  const timeoutMs = issueLsTimeoutMs ?? ISSUE_LS_TIMEOUT_MS;
  const issues = new Map<string, GitIssue>();

  try {
    // stderr is piped (not inherited, not /dev/null) so the failure path
    // can quote it in the "failed" remedy while successful runs drop it.
    const output = execSync("git issue ls --all --format oneline", {
      encoding: "utf8",
      timeout: timeoutMs,
      cwd: issuesRoot,
      stdio: ["ignore", "pipe", "pipe"],
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
  } catch (e) {
    // Classify so messages and remedies can name the actual failure:
    // - timeout: execSync kills the child with SIGTERM (Node sets killed=true;
    //   Bun leaves killed unset and reports signal=SIGTERM + status=null).
    // - missing: the shell could not find git (exit 127) or spawn ENOENT.
    // - failed: the CLI ran and exited nonzero (corrupt store, bad args).
    // Previously every class reported "git issue CLI unavailable", so --fix
    // blamed a missing tool on repos whose registry was merely slow or
    // whose store was damaged.
    const err = e as {
      killed?: boolean;
      signal?: string | null;
      status?: number | null;
      code?: string | null;
      stderr?: string | Buffer;
    };
    if (err.killed === true || (err.signal === "SIGTERM" && err.status === null)) {
      return { issues, available: false, reason: "timeout" };
    }
    if (err.code === "ENOENT" || err.status === 127) {
      return { issues, available: false, reason: "missing" };
    }
    const status = err.status ?? (typeof err.code === "number" ? err.code : null);
    const stderrTail = typeof err.stderr === "string" || Buffer.isBuffer(err.stderr)
      ? err.stderr.toString("utf8").trim().split("\n").pop() ?? ""
      : "";
    const detail = stderrTail.slice(0, 160);
    return {
      issues,
      available: false,
      reason: "failed",
      ...(detail !== "" || status !== null
        ? { detail: detail === "" ? `exit ${status}` : `exit ${status}: ${detail}` }
        : {}),
    };
  }

  return { issues, available: true };
}

/**
 * Log the --fix refusal for an unreadable issue registry (all three failure
 * classes refuse: with the registry unknown, every non-commit hash looks
 * like a placeholder and --fix would mass-create issues). Always refuses —
 * the caller returns 1 after calling this.
 */
export function logFixRefusal(
  reason: GitIssueRead["reason"],
  failDetail: string | undefined,
  issueLsTimeoutMs: number,
): void {
  if (reason === "timeout") {
    log(
      "error",
      String(
        `git issue ls exceeded ${issueLsTimeoutMs / 1000}s — refusing to --fix.`,
      ).replace(/\n$/, ""),
    );
    log(
      "error",
      String(
        "  The CLI is present but the registry is too large to list in time; fix mode cannot distinguish stale hashes without it.",
      ).replace(/\n$/, ""),
    );
    return;
  }
  if (reason === "missing") {
    log("error", String(`git executable not found — refusing to --fix.`).replace(/\n$/, ""));
    log(
      "error",
      String(
        "  Fix mode reconciles against the git-issue registry; install git (or fix PATH) and re-run.",
      ).replace(/\n$/, ""),
    );
    return;
  }
  log(
    "error",
    String(
      `git issue ls failed${failDetail ? ` (${failDetail})` : ""} — refusing to --fix.`,
    ).replace(/\n$/, ""),
  );
  log(
    "error",
    String(
      "  The CLI ran but the registry could not be listed — run 'git issue ls --all' manually to inspect the store.",
    ).replace(/\n$/, ""),
  );
}

export function readIndex(indexPath: string): Record<string, IndexEntry> {
  if (!existsSync(indexPath)) return {};
  try {
    return JSON.parse(readFileSync(indexPath, "utf8"));
  } catch {
    return {};
  }
}
