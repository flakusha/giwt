// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt plan sync-docs` — mirror .plan/ markdown into docs/plan-gen/ for the
 * Vitepress site. Wipes the output dir, copies every .md file, generates
 * index pages with relative links.
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { WorktreeConfig } from "../../utils/config";
import { log, raw } from "../../utils/output";

const DIR_TITLES: Record<string, string> = {
  epics: "Epics",
  tickets: "Tickets",
  backlog: "Backlog",
};

const REPO_DOC_LINK_RE = /\]\(\.\.\/\.\.\/docs\//g;

function normalizePlanMarkdown(content: string): string {
  content = content.replaceAll(REPO_DOC_LINK_RE, "](../../");
  if (!content.startsWith("---\n")) return content;
  const bodyStart = content.search(/\n\*\*[^*\n]+:\*\*/);
  if (bodyStart === -1) return content;
  const frontmatterEnd = content.indexOf("\n---", 4);
  if (frontmatterEnd !== -1 && frontmatterEnd < bodyStart) return content;
  return `${content.slice(0, bodyStart)}\n---${content.slice(bodyStart)}`;
}

async function collectMdFiles(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      for (const nested of await collectMdFiles(join(dir, entry.name), rel)) files.push(nested);
    } else if (entry.name.endsWith(".md")) {
      files.push(rel);
    }
  }
  return files.sort();
}

async function writeRootIndex(outDir: string, mdFiles: string[], subdirs: string[]): Promise<void> {
  const lines = ["# Plan Index", ""];
  const topLevel = mdFiles.filter((rel) => !rel.includes("/"));
  if (topLevel.length > 0) {
    for (const rel of topLevel) lines.push(`- [${rel.replace(/\.md$/, "")}](./${rel})`);
    lines.push("");
  }
  for (const dir of subdirs) lines.push(`- [${DIR_TITLES[dir] ?? dir}](./${dir}/index.md)`);
  lines.push("");
  await writeFile(join(outDir, "index.md"), lines.join("\n"));
}

async function writeDirIndex(outDir: string, dir: string, mdFiles: string[]): Promise<void> {
  const title = DIR_TITLES[dir] ?? dir;
  const lines = [`# ${title}`, ""];
  for (const rel of mdFiles) {
    const name = rel.slice(dir.length + 1).replace(/\.md$/, "");
    lines.push(`- [${name}](./${rel.slice(dir.length + 1)})`);
  }
  lines.push("");
  await writeFile(join(outDir, dir, "index.md"), lines.join("\n"));
}

export async function runSyncDocs(args: string[], config: WorktreeConfig): Promise<void> {
  if (args.includes("--help") || args.includes("-h") || args.length > 0) {
    raw("Usage: giwt plan sync-docs");
    raw("  Mirror .plan/ markdown into docs/plan-gen/ for the Vitepress site");
    process.exit(args.includes("--help") || args.includes("-h") ? 0 : 1);
  }

  const planDir = join(config.worktreeRoot, config.settings.paths.planDir);
  const outDir = join(config.worktreeRoot, "docs", "plan-gen");

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const mdFiles = await collectMdFiles(planDir);
  for (const rel of mdFiles) {
    const dest = join(outDir, rel);
    await mkdir(dirname(dest), { recursive: true });
    const source = await readFile(join(planDir, rel), "utf8");
    await writeFile(dest, normalizePlanMarkdown(source));
  }

  const subdirs: string[] = [];
  for (const entry of await readdir(planDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const children = mdFiles.filter((rel) => rel.startsWith(`${entry.name}/`));
    if (children.length > 0) {
      subdirs.push(entry.name);
      await writeDirIndex(outDir, entry.name, children);
    }
  }
  subdirs.sort();

  await writeRootIndex(outDir, mdFiles, subdirs);
  log(
    "success",
    `synced ${mdFiles.length} markdown files to docs/plan-gen/ (${subdirs.length + 1} index pages)`,
  );
}
