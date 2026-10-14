// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt plan normalize-statuses` — normalize .plan status values onto their
 * closed vocabularies (epic headers + ticket index).
 *
 * .plan/ has two status vocabularies:
 *   PLAN (STATUS_ENUM): Not Started | In Progress | Blocked | Done | Wontfix | Postponed
 *   MATRIX (STATUS_COLUMNS): done | in_progress | open | draft | cancelled | other
 *
 * The index writer stores normalizeStatus(tf.status), which passes freeform
 * values through verbatim. This script repairs both sides:
 *   1. Epic .md headers — off-vocabulary values rewrite to canonical enum.
 *   2. index.json statuses — pass-through leftovers collapse into the matrix
 *      column their plan-vocabulary meaning implies.
 *
 * Idempotent. --check reports without writing, exits 1 on drift.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveStatus, scanHeaderStatusLines } from "../../plan/status-vocab";
import { resolveFromRoot } from "../../plan/validate";
import { assertIndexUnedited } from "../../tickets/index-stamp";
import { persistIndexCanonical } from "../../tickets/sync-index-write";
import { normalizeStatus } from "../../tickets/sync-normalize";
import type { WorktreeConfig } from "../../utils/config";
import { raw } from "../../utils/output";

const MATRIX_COLUMNS = ["done", "in_progress", "open", "draft", "cancelled", "other"] as const;

const PLAN_TO_MATRIX: Record<string, string> = {
  "Not Started": "open",
  "In Progress": "in_progress",
  "Blocked": "open",
  "Done": "done",
  "Wontfix": "cancelled",
  "Postponed": "open",
};

type Tally = Map<string, number>;

function bucketOf(value: string): string {
  const n = normalizeStatus(value);
  return (MATRIX_COLUMNS as readonly string[]).includes(n) ? n : "other";
}

function normalizeEpics(check: boolean, epicsDir: string, aliases: Record<string, string>): Tally {
  const tally: Tally = new Map();
  if (!existsSync(epicsDir)) return tally;
  for (const file of readdirSync(epicsDir).sort()) {
    if (!file.endsWith(".md")) continue;
    const path = join(epicsDir, file);
    const head = scanHeaderStatusLines(path)[0];
    if (!head) continue;
    const raw = head.value.trim();
    const { value, action } = resolveStatus(raw, aliases);
    if (action === "valid") continue;
    if (action === "invalid") {
      const label = `INVALID ${JSON.stringify(raw)} (${file} — needs a human call)`;
      tally.set(label, (tally.get(label) ?? 0) + 1);
      continue;
    }
    const label = `${JSON.stringify(raw)} -> ${JSON.stringify(value)}`;
    tally.set(label, (tally.get(label) ?? 0) + 1);
    if (check) continue;
    const lines = readFileSync(path, "utf8").split("\n");
    lines[head.line] = head.text.replace(head.value, value);
    writeFileSync(path, lines.join("\n"));
  }
  return tally;
}

function matrixTargetFor(raw: string, aliases: Record<string, string>): string | null {
  const { value, action } = resolveStatus(raw, aliases);
  if (action === "invalid") return null;
  const core = value.replace(/\s*\([^)]*\)\s*$/s, "").trim();
  return PLAN_TO_MATRIX[core] ?? bucketOf(value);
}

interface IndexResult {
  changes: Tally;
  unresolved: Tally;
  columns: string[];
}

function normalizeIndex(
  check: boolean,
  repoRoot: string,
  indexPath: string,
  aliases: Record<string, string>,
): IndexResult {
  const changes: Tally = new Map();
  const unresolved: Tally = new Map();
  if (!existsSync(indexPath)) return { changes, unresolved, columns: [] };

  // Fail closed on a stamped-but-mismatched index before consuming it.
  assertIndexUnedited(indexPath);
  const index = JSON.parse(readFileSync(indexPath, "utf8")) as Record<
    string,
    { status?: string; [k: string]: unknown; }
  >;
  const counts: Record<string, number> = {};
  let dirty = false;

  for (const [extid, entry] of Object.entries(index)) {
    const current = entry.status ?? "undefined";
    const bucket = bucketOf(current);
    if (bucket !== "other") {
      counts[bucket] = (counts[bucket] ?? 0) + 1;
      continue;
    }

    const target = matrixTargetFor(current, aliases);
    if (target === null) {
      unresolved.set(current, (unresolved.get(current) ?? 0) + 1);
      counts[bucket] = (counts[bucket] ?? 0) + 1;
      continue;
    }
    counts[target] = (counts[target] ?? 0) + 1;
    if (target === current) continue;
    const label = `${JSON.stringify(current)} -> ${JSON.stringify(target)}`;
    changes.set(label, (changes.get(label) ?? 0) + 1);
    if (check) continue;
    index[extid] = { ...entry, status: target };
    dirty = true;
  }

  if (dirty && !check) {
    const sorted = Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b)));
    // Canonical writer: atomic bytes + fresh fingerprint stamp.
    persistIndexCanonical(repoRoot, indexPath, sorted);
  }

  return {
    changes,
    unresolved,
    columns: MATRIX_COLUMNS.map((c) => `  ${c.padEnd(12)} ${String(counts[c] ?? 0).padStart(5)}`),
  };
}

function report(title: string, tally: Tally, note = ""): void {
  raw(`\n${title}`);
  if (tally.size === 0) {
    raw("  (nothing to do — already canonical)");
    return;
  }
  for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    raw(`  ${String(n).padStart(5)}  ${k.length > 112 ? `${k.slice(0, 109)}...` : k}`);
  }
  raw(`  ${"-".repeat(66)}\n  total: ${[...tally.values()].reduce((a, b) => a + b, 0)}${note}`);
}

export async function runNormalizeStatuses(args: string[], config: WorktreeConfig): Promise<void> {
  const check = args.includes("--check");
  const unknown = args.filter((a) => a !== "--help" && a !== "-h" && a !== "--check");
  if (unknown.length > 0 || args.includes("--help") || args.includes("-h")) {
    raw("Usage: giwt plan normalize-statuses [--check]");
    raw("  Normalize .plan status values onto closed vocabularies (epic headers + ticket index)");
    raw("  --check  report only, exit 1 on drift");
    process.exit(args.includes("--help") || args.includes("-h") ? 0 : 1);
  }

  const planDir = resolveFromRoot(config.worktreeRoot, config.settings.paths.planDir);
  const epicsDir = join(planDir, "epics");
  const indexPath = join(planDir, "tickets", "index.json");
  const aliases = config.settings.status.aliases;

  raw(
    `plan status normalize — ${check ? "check only" : "applying"} (root: ${config.worktreeRoot})`,
  );

  const epics = normalizeEpics(check, epicsDir, aliases);
  const index = normalizeIndex(check, config.repoRoot, indexPath, aliases);

  report("=== EPIC headers (.plan/epics/*.md) ===", epics);
  report("=== TICKET index (.plan/tickets/index.json) ===", index.changes);
  report(
    "=== UNRESOLVED — in neither vocabulary, left untouched ===",
    index.unresolved,
    "\n  add a [status.aliases] entry in giwt.toml to settle these",
  );
  if (index.columns.length > 0) {
    raw("\n=== feature-matrix columns after this run ===\n" + index.columns.join("\n"));
  }
  raw(
    check
      ? "\n--check: exit 1 means the values above would change."
      : "\ndone. Regenerate the derived artifacts: giwt plan gen-docs && giwt plan matrix",
  );

  const drift = [...epics.values(), ...index.changes.values()].some((n) => n > 0);
  if (check && drift) process.exit(1);
}
