// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt docs sync-agents` — mirror the markdown corpus into an agents
 * directory (default `.agents`) as one flat markdown file per doc:
 *
 * ---
 * name: <doc name>
 * description: <extracted title, else the doc name>
 * source: <doc name>
 * ---
 * <full doc body>
 *
 * Doc names containing `/` are flattened with `->` (e.g.
 * `plan/tickets/index` -> `plan->tickets->index.md`). Output is
 * idempotent: corpus order is the deterministic path sort, reruns
 * produce identical bytes, and files in the target dir that no doc
 * manages are left alone (reported as `unmanaged`).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { type OutFormat, renderRecords } from "../../utils/emit";
import { log, raw } from "../../utils/output";
import { type Doc, extractTitle, readTextLoose } from "./corpus";

const DEFAULT_DIR = ".agents";

const USAGE = "Usage: giwt docs sync-agents [--dir <path>] [--json|--toml|--emoji]";

interface SyncRecord {
  name: string;
  file: string;
  action: "written" | "unchanged" | "skipped";
}

/** `plan/tickets/index` -> `plan->tickets->index`. Exported as the stable
 *  flattening contract between the command and its tests. */
export function flattenName(name: string): string {
  return name.replaceAll("/", "->");
}

/** The exact bytes managed for a doc; reruns must produce these. */
export function agentFileBytes(doc: Doc, text: string): string {
  const title = extractTitle(text);
  return `---\nname: ${doc.name}\ndescription: ${
    title === "" ? doc.name : title
  }\nsource: ${doc.name}\n---\n${text}`;
}

function listManagedFiles(corpus: Doc[]): Map<string, Doc> {
  const managed = new Map<string, Doc>();
  for (const doc of corpus) managed.set(`${flattenName(doc.name)}.md`, doc);
  return managed;
}

function countUnmanaged(dir: string, managed: Map<string, Doc>): number {
  let unmanaged = 0;
  for (const entry of readdirSync(dir)) {
    if (entry.endsWith(".md") && !managed.has(entry)) unmanaged++;
  }
  return unmanaged;
}

export function syncAgents(corpus: Doc[], root: string, args: string[], format: OutFormat): void {
  let dirValue = DEFAULT_DIR;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--dir") {
      if (i + 1 >= args.length) {
        log("error", "--dir requires a path argument");
        process.exit(1);
      }
      dirValue = args[++i]!;
    } else if (a.startsWith("--dir=")) {
      dirValue = a.slice("--dir=".length);
    } else {
      log("error", `unknown docs sync-agents argument '${a}'\n${USAGE}`);
      process.exit(1);
    }
  }

  // Refuse paths resolving outside the worktree root (including via
  // `..` or absolute targets); everything inside is fine.
  const dir = resolve(root, dirValue);
  if (dir !== root && !dir.startsWith(root + sep)) {
    log("error", `--dir '${dirValue}' resolves outside the worktree root (${root})`);
    process.exit(1);
  }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const managed = listManagedFiles(corpus);
  const records: SyncRecord[] = [];
  // corpus is the deterministic path sort, so writes are stable.
  for (const doc of corpus) {
    const text = readTextLoose(doc);
    const file = join(dir, `${flattenName(doc.name)}.md`);
    if (text === null) {
      records.push({ name: doc.name, file, action: "skipped" });
      continue;
    }
    const bytes = agentFileBytes(doc, text);
    const existing = existsSync(file) ? readFileSync(file, "utf8") : null;
    if (existing !== bytes) writeFileSync(file, bytes);
    records.push({ name: doc.name, file, action: existing === bytes ? "unchanged" : "written" });
  }

  const unmanaged = countUnmanaged(dir, managed);
  const written = records.filter((r) => r.action === "written").length;
  const skipped = records.filter((r) => r.action === "skipped").length;
  const unchanged = records.filter((r) => r.action === "unchanged").length;

  if (format !== "human") {
    raw(
      renderRecords(records, format, {
        emoji: (record) => {
          const r = record as SyncRecord;
          return `📄 ${r.file} — ${r.action}`;
        },
      }),
    );
  }
  log(
    "info",
    `sync-agents: written ${written}, unchanged ${unchanged}, skipped ${skipped}, unmanaged ${unmanaged} (dir: ${dir})`,
  );
}
