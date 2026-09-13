// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * node_modules health + linking for worktrees.
 *
 * Worktrees reuse the root install via symlink. Two failure modes bit us:
 * - root node_modules rots (e.g. self-referential symlink loop) — existsSync
 *   returns false on ELOOP, so callers silently skipped the link and every
 *   worktree command failed cryptically downstream;
 * - a worktree link dangles after root rot — existsSync is false for dangling
 *   links, so a naive re-link throws EEXIST instead of repairing.
 */

import { existsSync, lstatSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { log } from "./output";

/**
 * True when path is a usable directory (real dir or healthy symlink).
 * Missing paths, dangling links, and symlink loops return false.
 * @param path
 */
export function isUsableModulesDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Symlink root node_modules into a worktree. Warns (never throws) when the
 * root install is unusable, and repairs dangling worktree links.
 * @param repoRoot
 * @param wtPath
 */
export function linkNodeModules(repoRoot: string, wtPath: string): void {
  const mainModules = resolve(repoRoot, "node_modules");
  const wtModules = resolve(wtPath, "node_modules");
  if (!isUsableModulesDir(mainModules)) {
    log(
      "warn",
      `root node_modules unusable at ${mainModules} — skipping link (run \`bun install\` in ${repoRoot})`,
    );
    return;
  }
  try {
    let wtLink = null;
    try {
      wtLink = lstatSync(wtModules);
    } catch {
      wtLink = null;
    }
    if (wtLink !== null && !existsSync(wtModules)) {
      unlinkSync(wtModules);
    }
    if (!existsSync(wtModules)) {
      symlinkSync(mainModules, wtModules);
      log("success", "node_modules linked");
    }
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    log("warn", `node_modules link failed (${reason})`);
  }
}
