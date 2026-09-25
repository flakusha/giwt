// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Markdown stale-link guard.
 *
 * Scans Markdown files and flags intra-repo links whose target does not
 * resolve to an existing repository path. Catches links that rot when
 * files/epics/tickets are renamed or deleted.
 *
 * What is checked:
 * - Inline links `[text](target)` and images `![alt](target)`
 * - Reference links `[text][ref]` (ref resolved via `[ref]: target`)
 * - Relative paths resolved against the containing file or repo root
 * - Anchors have their `#fragment` stripped before file resolution
 * - Bare `TASK-xxx` refs in .plan/ files resolve against tickets dir
 *
 * What is skipped:
 * - Absolute web URLs (`http://`, `https://`, `mailto:`, `ftp://`)
 * - Anchor-only links (`[x](#section)`) — same-file anchors
 * - Code spans and fenced code blocks
 * - Auto-links `<https://...>`
 *
 * Pure logic — no process.exit / console.log. Caller handles reporting.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, resolve as resolvePath } from "node:path";
import { collectMdFiles } from "./code-map";
import { extractComments, extractDocRefs } from "./src-refs";

// ── File collection ─────────────────────────────────────────────

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".venv",
  "coverage",
  ".vitepress",
]);

const SRC_EXTS = new Set([".ts", ".tsx"]);

/** Recursively collect TypeScript source files under src/. */
export function collectSrcFiles(projectRoot: string, srcDir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      if (SKIP_DIRS.has(entry)) continue;
      const p = join(d, entry);
      if (statSync(p).isDirectory()) {
        walk(p);
      } else if (SRC_EXTS.has(p.slice(p.lastIndexOf(".")))) {
        out.push(p);
      }
    }
  };
  const srcRoot = join(projectRoot, srcDir);
  if (existsSync(srcRoot)) walk(srcRoot);
  return out;
}

// ── Markdown parsing ────────────────────────────────────────────

/** Strip fenced code blocks (```…```). */
export function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "");
}

/** Strip inline code spans (`…`). */
export function stripInlineCode(text: string): string {
  return text.replace(/`[^`]+`/g, "");
}

/** Collect `[label](target)` and `[label][ref]` usages. */
export function collectLinks(text: string): string[] {
  const links: string[] = [];
  // Inline: [text](target "title"?) — capture the URL portion
  const inlineRe = /\[([^\]]*)\]\((\s*<?([^)\s]+?|...)?>?(?:\s+"[^"]*")?\s*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = inlineRe.exec(text)) !== null) {
    const inner = m[2] ?? "";
    const target = inner.match(/([^)\s"']+)/);
    if (target && target[1]) links.push(target[1]);
  }
  // Reference definitions + usages
  const defRe = /^\[([^\]]+)\]:\s*(.+)$/gm;
  const defs = new Map<string, string>();
  while ((m = defRe.exec(text)) !== null) {
    const key = m[1];
    const val = m[2];
    if (key && val) defs.set(key.toLowerCase(), val.trim());
  }
  const useRe = /\[[^\]]*\]\[([^\]]+)\]/g;
  while ((m = useRe.exec(text)) !== null) {
    const refKey = m[1];
    if (refKey) {
      const target = defs.get(refKey.toLowerCase());
      if (target) links.push(target);
    }
  }
  return links;
}

// ── Target classification ───────────────────────────────────────

/** True if the target is an absolute/external URL we should not resolve. */
export function isExternal(target: string): boolean {
  return /^(https?:|mailto:|ftp:|tel:|data:)/i.test(target);
}

/** True if target is anchor-only (#fragment, same-file). */
export function isAnchorOnly(target: string): boolean {
  return target.startsWith("#") && !target.startsWith("#/");
}

// ── Target resolution ───────────────────────────────────────────

/**
 * Resolve a relative target path against the containing file.
 * Returns the absolute path, or null if unresolvable (external/site-route).
 */
export function resolveTarget(
  target: string,
  containingFile: string,
  projectRoot: string,
  ticketsDir: string,
): string | null {
  // Strip anchor fragment
  const pathPart = target.split("#")[0];
  if (!pathPart) return null;

  // Repo-root-relative prefixes
  const trimmed = pathPart.replace(/^\//, "");
  if (
    trimmed.startsWith("docs/") || trimmed.startsWith(".plan/") || trimmed.startsWith("src/")
  ) {
    return join(projectRoot, trimmed);
  }
  // `/plan/...` is shorthand for `.plan/...`
  if (trimmed.startsWith("plan/") || trimmed === "plan") {
    return join(projectRoot, trimmed.replace(/^plan/, ".plan"));
  }
  // Other `/`-prefixed paths are site routes — not resolvable
  if (pathPart.startsWith("/")) return null;
  // Bare `TASK-*.md` in .plan/ docs mean a ticket in tickets/
  if (/^TASK-[\w-]+\.md$/.test(pathPart)) {
    const ticket = resolve(projectRoot, ticketsDir, pathPart);
    if (existsSync(ticket)) return ticket;
  }
  // Else relative to the containing file's directory
  return resolvePath(dirname(containingFile), pathPart);
}

// ── Bare-text TASK-ref resolution ───────────────────────────────

/** A bare TASK-xxx ref found in prose (not inside a markdown link). */
export interface TaskRef {
  ref: string;
  line: string;
}

/** Collect bare `TASK-xxx` refs NOT inside markdown link syntax. */
export function collectTaskRefs(text: string): TaskRef[] {
  const out: TaskRef[] = [];
  const re = /TASK-[A-Za-z0-9-]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const ref = m[0];
    const at = m.index;
    const prev = text[at - 1] ?? "";
    const next = text[at + ref.length] ?? "";
    // Skip markdown link labels: [TASK-x](...) or [TASK-x][ref]
    // Also skip when next is ] (bare label without immediate ( or [)
    if (prev === "[" && (next === "(" || next === "[" || next === "]")) continue;
    const lineStart = text.lastIndexOf("\n", at - 1) + 1;
    const lineEnd = text.indexOf("\n", at + ref.length);
    const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    out.push({ ref, line });
  }
  return out;
}

// ── Check results ───────────────────────────────────────────────

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
  srcFileCount: number;
}

// ── Main check ──────────────────────────────────────────────────

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
