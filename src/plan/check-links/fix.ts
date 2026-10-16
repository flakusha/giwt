// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Auto-repair for the stale-link guard (FEAT-plan-check-links-fix):
 * rewrites broken markdown link targets and orphan TASK- refs to their
 * resolved location so a renamed epic/ticket is repaired mechanically.
 *
 * Repair strategy — the scan only knows a target does not exist, so the
 * fixer re-locates the file:
 * - broken links: the unique .md file repo-wide with the same basename;
 *   the target is rewritten to a path relative to the containing file
 *   (anchor fragments preserved).
 * - TASK refs: refs in .plan/ files that no longer name a ticket exactly
 *   but have a UNIQUE ticket-file prefix candidate (a renamed ticket's
 *   old id) are rewritten to the canonical TASK id. Refs the scanner
 *   flags as true orphans (no fuzzy match at all) and ambiguous prefixes
 *   are left untouched. Rewrites preserve all surrounding
 * markdown decoration (whole-token replacement only). Idempotent: a
 * second run finds nothing broken and rewrites nothing.
 *
 * Pure logic — no process.exit / console.log. Caller handles reporting.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { runLinkCheck } from "./check";
import { stripCodeBlocks, stripInlineCode } from "./parse";
import { collectTaskRefs } from "./resolve";

const SKIP_DIRS: readonly string[] = [".git", "node_modules", ".tmp"];

export interface LinkFix {
  file: string;
  kind: "link" | "task-ref";
  from: string;
  to: string;
}

export interface FixResult {
  /** Applied rewrites, in file order. */
  fixed: LinkFix[];
  /** Broken links with no unique repair candidate (left untouched). */
  unfixableLinks: string[];
  /** Orphan TASK refs with no unique repair candidate. */
  unfixableRefs: string[];
}

/** All .md files under root, skipping VCS/dependency/scratch dirs. */
function collectAllMdFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP_DIRS.includes(e)) continue;
      const p = join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (e.endsWith(".md")) out.push(p);
    }
  };
  walk(root);
  return out;
}

/** Unique .md file repo-wide with the given basename, or null. */
function uniqueBasenameMatch(target: string, mdFiles: string[]): string | null {
  const name = basename(target.split("#")[0] ?? "");
  if (name.length === 0) return null;
  const matches = mdFiles.filter((f) => basename(f) === name);
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * New relative link target from the containing file to the repaired
 * path, POSIX separators, anchor fragment preserved.
 */
function relinkTarget(fromFile: string, toPath: string, originalTarget: string): string {
  let rel = relative(dirname(fromFile), toPath);
  if (!rel.startsWith(".")) rel = `./${rel}`;
  const anchor = originalTarget.includes("#")
    ? `#${originalTarget.split("#").slice(1).join("#")}`
    : "";
  return `${rel}${anchor}`;
}

/** Ticket files (lowercased basenames) in the tickets dir. */
function ticketFileNames(projectRoot: string, ticketsDir: string): string[] {
  const abs = join(projectRoot, ticketsDir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).filter((f) => f.endsWith(".md")).map((f) => f.toLowerCase());
}

/**
 * Scan + apply in-place repairs. Writes only files whose text actually
 * changed; reports every rewrite through `fixed`.
 */
export function applyLinkFixes(
  projectRoot: string,
  scanDirs: string[],
  ticketsDir: string,
  srcDir: string,
): FixResult {
  const scan = runLinkCheck(projectRoot, scanDirs, ticketsDir, srcDir);
  const mdFiles = collectAllMdFiles(projectRoot);
  const tickets = ticketFileNames(projectRoot, ticketsDir);

  const result: FixResult = { fixed: [], unfixableLinks: [], unfixableRefs: [] };
  const rewrites = new Map<string, Array<[string, string]>>();

  for (const broken of scan.broken) {
    const match = uniqueBasenameMatch(broken.target, mdFiles);
    if (match === null) {
      result.unfixableLinks.push(`${broken.file}: ${broken.target}`);
      continue;
    }
    const to = relinkTarget(broken.file, match, broken.target);
    const pending = rewrites.get(broken.file) ?? [];
    pending.push([broken.target, to]);
    rewrites.set(broken.file, pending);
  }

  for (const orphan of scan.orphanRefs) {
    // A scan orphan has NO fuzzy ticket match at all — there is nothing
    // to relink it to; it stays an error for the final re-scan.
    result.unfixableRefs.push(`${orphan.file}: ${orphan.ref}`);
  }

  // Stale TASK refs: the scanner fuzzy-resolves a ref when any ticket
  // file contains the stem, so a renamed ticket (task-add-trace ->
  // task-add-trace-fatal) leaves prose refs silently fuzzy-stale. The
  // fixer repairs those to the unique exact/prefix candidate.
  const planDirAbs = join(projectRoot, ".plan");
  for (const file of mdFiles) {
    if (!file.startsWith(planDirAbs)) continue;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const refs = collectTaskRefs(stripInlineCode(stripCodeBlocks(text)));
    for (const { ref } of refs) {
      const stem = ref.toLowerCase();
      if (tickets.includes(`${stem}.md`)) continue; // exact: current
      const candidates = tickets.filter((t) => t.startsWith(stem));
      if (candidates.length !== 1) continue; // ambiguous or unresolvable
      const canonical = `TASK-${candidates[0]!.replace(/\.md$/, "").replace(/^task-/, "")}`;
      const pending = rewrites.get(file) ?? [];
      pending.push([ref, canonical]);
      rewrites.set(file, pending);
    }
  }

  for (const [file, pairs] of rewrites) {
    let text = readFileSync(file, "utf8");
    const original = text;
    for (const [from, to] of pairs) {
      if (!text.includes(from)) continue;
      if (from.startsWith("TASK-")) {
        // Whole-token only: `TASK-a` must not match inside `TASK-a-b`.
        text = text.replace(new RegExp(`${from}(?![A-Za-z0-9-])`, "g"), to);
      } else {
        // Link context only: `](target)` inline links and `]: target`
        // reference definitions.
        text = text.split(`](${from})`).join(`](${to})`);
        text = text.split(`]: ${from}`).join(`]: ${to}`);
      }
    }
    if (text !== original) {
      for (const [from, to] of pairs) {
        result.fixed.push({ file, kind: from.startsWith("TASK-") ? "task-ref" : "link", from, to });
      }
      writeFileSync(file, text);
    }
  }
  return result;
}
