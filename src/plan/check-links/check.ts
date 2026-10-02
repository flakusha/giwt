// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Per-file link checks and the full-scan entry point for the markdown
 * stale-link guard: broken intra-repo links, orphan bare-text TASK refs,
 * and stale `.plan/`/`docs/` citations in source comments.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { collectMdFiles } from "../code-map";
import { extractComments, extractDocRefs } from "../src-refs";
import { collectSrcFiles } from "./collect";
import { collectLinks, isAnchorOnly, isExternal, stripCodeBlocks, stripInlineCode } from "./parse";
import { collectTaskRefs, resolveTarget } from "./resolve";

export interface BrokenLink {
  file: string;
  target: string;
  resolved: string;
}

export interface OrphanTaskRef {
  file: string;
  ref: string;
  line: string;
}

export interface BrokenCommentCitation {
  file: string;
  path: string;
  resolved: string;
}

export interface LinkCheckResult {
  broken: BrokenLink[];
  orphanRefs: OrphanTaskRef[];
  brokenComments: BrokenCommentCitation[];
  fileCount: number;
  /** Source files whose comments were scanned (test files excluded). */
  srcFileCount: number;
}

/**
 * Check one markdown file for broken internal links + orphan TASK refs.
 * `ticketFiles` is a Set of basenames from the tickets dir for fuzzy matching.
 */
export function checkFile(
  file: string,
  projectRoot: string,
  ticketsDir: string,
  ticketFiles: Set<string>,
): { broken: BrokenLink[]; orphanRefs: OrphanTaskRef[]; } {
  const broken: BrokenLink[] = [];
  const orphanRefs: OrphanTaskRef[] = [];

  if (!existsSync(file)) return { broken, orphanRefs };

  const raw = readFileSync(file, "utf8");

  // Strip inline code + fenced blocks for link extraction
  const cleanText = stripInlineCode(stripCodeBlocks(raw));

  // Check markdown links
  for (const target of collectLinks(cleanText)) {
    if (isExternal(target)) continue;
    if (isAnchorOnly(target)) continue;

    const resolved = resolveTarget(target, file, projectRoot, ticketsDir);
    if (!resolved) continue;
    if (!existsSync(resolved)) {
      broken.push({ file, target, resolved });
    }
  }

  // Bare-text TASK refs (epic/backlog tables, prose)
  if (file.startsWith(join(projectRoot, ".plan"))) {
    const selfTitle = raw.split("\n").find((l) => l.startsWith("# ")) ?? "";
    const refText = raw.replace(/```[\s\S]*?```/g, "");
    for (const { ref, line } of collectTaskRefs(refText)) {
      // Skip the file's own H1 title (self-ref)
      const titleRef = selfTitle.match(/TASK-[\w-]+/)?.[0]?.toLowerCase();
      if (
        (line === selfTitle && titleRef
          && ref.toLowerCase().startsWith(titleRef.replace(/^TASK-/, "")))
        || ref.toLowerCase() === titleRef
      ) {
        continue;
      }
      const name = ref.toLowerCase() + ".md";
      // Prefix refs allowed: `TASK-add-trace` matches `task-add-trace-fatal.md`
      const resolves = ticketFiles.has(name)
        || [...ticketFiles].some(
          (n) => n.startsWith(name) || n.includes(name.replace(/\.md$/, "")),
        );
      if (!resolves) {
        orphanRefs.push({ file, ref, line: line.trim().slice(0, 80) });
      }
    }
  }

  return { broken, orphanRefs };
}

/** Check a TS source file's comments for stale `.plan/` + `docs/` refs. */
export function checkSrcComments(
  file: string,
  projectRoot: string,
  ticketsDir: string,
): BrokenCommentCitation[] {
  const broken: BrokenCommentCitation[] = [];
  if (!existsSync(file)) return broken;

  const raw = readFileSync(file, "utf8");
  let comments: string[];
  try {
    comments = extractComments(raw);
  } catch {
    return broken; // unparseable source — skip
  }
  for (const comment of comments) {
    for (const { path } of extractDocRefs(comment)) {
      const resolved = resolveTarget(path, file, projectRoot, ticketsDir);
      if (!resolved) continue;
      if (!existsSync(resolved)) {
        broken.push({ file, path, resolved });
      }
    }
  }
  return broken;
}

/** Run full link check across markdown + source files. */
export function runLinkCheck(
  projectRoot: string,
  scanDirs: string[],
  ticketsDir: string,
  srcDir: string,
): LinkCheckResult {
  const files = new Set<string>();
  for (const dir of scanDirs) {
    for (const f of collectMdFiles(projectRoot, dir)) {
      files.add(f);
    }
  }

  // Collect ticket filenames for TASK-ref resolution
  const ticketFiles = new Set<string>();
  const ticketsAbs = resolve(projectRoot, ticketsDir);
  if (existsSync(ticketsAbs)) {
    for (const f of readdirSync(ticketsAbs)) {
      if (f.endsWith(".md")) ticketFiles.add(f.toLowerCase());
    }
  }

  const broken: BrokenLink[] = [];
  const orphanRefs: OrphanTaskRef[] = [];

  for (const file of files) {
    const r = checkFile(file, projectRoot, ticketsDir, ticketFiles);
    broken.push(...r.broken);
    orphanRefs.push(...r.orphanRefs);
  }

  // Source-comment citations
  const srcFiles = collectSrcFiles(projectRoot, srcDir);
  const brokenComments: BrokenCommentCitation[] = [];
  for (const file of srcFiles) {
    brokenComments.push(...checkSrcComments(file, projectRoot, ticketsDir));
  }

  return {
    broken,
    orphanRefs,
    brokenComments,
    fileCount: files.size,
    srcFileCount: srcFiles.length,
  };
}
