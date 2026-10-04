// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
// size-allow: 300

/**
 * Runs command — list recent run records (the analyzable view over
 * meta.json in each run dir under paths.runlog/runs) — plus failure
 * triage over the captured bun-test log (`test.log`) a run dir carries:
 *
 *   triage <run-dir-or-id-prefix>  print failing blocks from the capture
 *   diff <runA> <runB>             set-diff failure identities between
 *                                  two runs (report only, never gates)
 *
 * Usage: giwt runs [--last N] [--json|--toml|--emoji]
 *        giwt runs triage <run> [--json|--toml|--emoji]
 *        giwt runs stats [--last N] [--json|--toml|--emoji]
 *        giwt runs diff <runA> <runB> [--json|--toml|--emoji]
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { type WorktreeConfig } from "../utils/config";
import { type OutFormat, parseOutFlags, renderRecords } from "../utils/emit";
import { diffFailures, type FailBlock, parseFailBlocks } from "../utils/failtriage";
import { colorize, log, raw } from "../utils/output";
import { formatOutcome, listRuns, readRunEvents } from "../utils/runlog";

import { stats } from "./runs-stats";

/** TOML cannot represent null: drop null-valued fields from the record
 *  (said: null et al). JSON parse-back keeps every non-null field. */
function stripNulls<T extends Record<string, unknown>>(record: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== null) out[key] = value;
  }
  return out;
}

/** Runs scratchpad root — mirrors runlog's private runsRoot(). */
function runsRoot(config: WorktreeConfig): string {
  return resolve(config.repoRoot, config.settings.paths.runlog, "runs");
}

/**
 * Resolve `<run-dir-or-id-prefix>`: an existing directory path wins, else
 * exactly one dir-name prefix match under the runs root.
 */
function resolveRunDir(
  config: WorktreeConfig,
  ref: string,
): { dir: string; } | { problem: string; } {
  if (existsSync(ref)) {
    if (statSync(ref).isDirectory()) return { dir: resolve(ref) };
    return { problem: `${ref}: not a run directory` };
  }
  const root = runsRoot(config);
  let names: string[];
  try {
    names = readdirSync(root).filter((name) => name.startsWith(ref)).sort();
  } catch {
    return { problem: `no run record matching '${ref}' under ${root}` };
  }
  if (names.length === 1) return { dir: join(root, names[0]!) };
  if (names.length === 0) {
    return { problem: `no run record matching '${ref}' under ${root}` };
  }
  return {
    problem: `ambiguous run id '${ref}' — matches ${names.length} runs:\n  ${names.join("\n  ")}`,
  };
}

/** Resolved run ref, or a user-facing error + exit 1. */
function requireRun(config: WorktreeConfig, ref: string): string {
  const resolved = resolveRunDir(config, ref);
  if ("problem" in resolved) {
    log("error", resolved.problem);
    process.exit(1);
  }
  return resolved.dir;
}

/** A run's captured bun-test log, or a user-facing error + exit 1. */
function readCapture(dir: string): string {
  const path = join(dir, "test.log");
  try {
    return readFileSync(path, "utf8");
  } catch {
    log("error", `${dir}: no captured test output (${path})`);
    process.exit(1);
  }
}

/** File-qualified failure name for human/emoji lines. */
function failLabel(entry: { test: string; file?: string | undefined; }): string {
  return entry.file !== undefined ? `${entry.test} (${entry.file})` : entry.test;
}

/** Machine triage record for one failure block. */
function triageRecord(block: FailBlock): Record<string, unknown> {
  return {
    test: block.test,
    ...(block.file !== undefined ? { file: block.file } : {}),
    "context-lines": block.lines,
  };
}

/** `giwt runs triage <run>` — failing blocks from one run's captured log. */
async function triageRun(
  rest: string[],
  config: WorktreeConfig,
  format: OutFormat,
): Promise<void> {
  const ref = rest[0];
  if (ref === undefined || rest.length > 1) {
    log("error", "usage: giwt runs triage <run-dir-or-id-prefix> [--json|--toml|--emoji]");
    process.exit(1);
  }
  const dir = requireRun(config, ref);
  const blocks = parseFailBlocks(readCapture(dir));
  if (format !== "human") {
    raw(renderRecords(blocks.map(triageRecord), format, {
      emoji: (record) => {
        const rec = record as { test: string; file?: string; };
        return `❌ ${failLabel(rec)}`;
      },
    }));
    return;
  }
  if (blocks.length === 0) {
    log("success", `No failures in ${dir}`);
    return;
  }
  log("info", `${blocks.length} failure${blocks.length === 1 ? "" : "s"} in ${dir}`);
  // Group by file when the log carries file paths; file-less blocks share
  // one "(no file section)" group.
  const groups = new Map<string, FailBlock[]>();
  for (const block of blocks) {
    const key = block.file ?? "";
    const list = groups.get(key);
    if (list) list.push(block);
    else groups.set(key, [block]);
  }
  for (const [file, list] of groups) {
    raw(file === "" ? "  (no file section)" : `  ${file}`);
    for (const block of list) {
      raw(`    ✗ ${block.test}`);
      for (const line of block.lines) raw(`      ${line}`);
    }
  }
}

/**
 * `giwt runs diff <runA> <runB>` — set-diff failure identities between two
 * runs. Report, not gate: diffs exist → still exit 0.
 */
async function diffRuns(
  rest: string[],
  config: WorktreeConfig,
  format: OutFormat,
): Promise<void> {
  if (rest.length !== 2) {
    log("error", "usage: giwt runs diff <runA> <runB> [--json|--toml|--emoji]");
    process.exit(1);
  }
  const dirA = requireRun(config, rest[0]!);
  const dirB = requireRun(config, rest[1]!);
  const diff = diffFailures(parseFailBlocks(readCapture(dirA)), parseFailBlocks(readCapture(dirB)));
  if (format !== "human") {
    const records = [
      ...diff.new.map((block) => ({
        test: block.test,
        ...(block.file !== undefined ? { file: block.file } : {}),
        kind: "new",
      })),
      ...diff.fixed.map((block) => ({
        test: block.test,
        ...(block.file !== undefined ? { file: block.file } : {}),
        kind: "fixed",
      })),
    ];
    raw(renderRecords(records, format, {
      emoji: (record) => {
        const rec = record as { test: string; kind: string; };
        return `${rec.kind === "new" ? "🆕" : "✅"} ${rec.test}`;
      },
    }));
    return;
  }
  if (diff.new.length === 0 && diff.fixed.length === 0) {
    log("success", `No failure changes between ${dirA} and ${dirB}`);
    return;
  }
  log("info", `Failure diff ${dirA} → ${dirB}`);
  raw(`  new (${diff.new.length}):`);
  for (const block of diff.new) raw(`    ✗ ${failLabel(block)}`);
  raw(`  fixed (${diff.fixed.length}):`);
  for (const block of diff.fixed) raw(`    ✓ ${failLabel(block)}`);
}

export async function runs(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const { format, rest } = parseOutFlags(args);
  const subcommand = rest[0];
  if (subcommand === "triage" || subcommand === "diff" || subcommand === "stats") {
    rest.shift();
    if (subcommand === "triage") return triageRun(rest, config, format);
    if (subcommand === "diff") return diffRuns(rest, config, format);
    return stats({ args: rest, config, format });
  }
  if (args.filter((a) => a === "--json" || a === "--toml" || a === "--emoji").length > 1) {
    log("warn", `multiple output flags given — using --${format}`);
  }
  let last = 20;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === undefined) break;
    if (arg === "--last") {
      const value = parseInt(rest[++i] ?? "", 10);
      if (Number.isFinite(value) && value > 0) last = value;
    } else if (arg.startsWith("--last=")) {
      const value = parseInt(arg.slice("--last=".length), 10);
      if (Number.isFinite(value) && value > 0) last = value;
    } else {
      log("error", `unknown flag '${arg}'`);
      raw("  Usage: giwt runs [--last N] [--json|--toml|--emoji]");
      process.exit(1);
    }
  }

  const records = listRuns(config, last).map((record) => ({
    ...record,
    // Per-step durations live in each run's events.jsonl, not in meta.json,
    // so the machine projection reads them here rather than carrying a
    // duplicated summary inside the meta record.
    events: readRunEvents(record.dir),
  }));
  if (format !== "human") {
    raw(renderRecords(records.map(stripNulls), format, {
      emoji: (record) => {
        const rec = record as { cmd: string; start: string; end?: string; exitCode?: number; };
        const mark = rec.exitCode === 0 ? "✅" : "❌";
        const dur = rec.end ? ` ${Date.parse(rec.end) - Date.parse(rec.start)}ms` : "";
        return `${mark} ${rec.cmd}${dur}`;
      },
    }));
    return;
  }
  if (records.length === 0) {
    log("info", "No run records");
    return;
  }
  for (const record of records) {
    const startMs = Date.parse(record.start);
    const dur = record.end ? `${Date.parse(record.end) - startMs}ms` : "abnormal";
    const exitLabel = record.exitCode === 0
      ? colorize(String(record.exitCode), "green")
      : colorize(record.exitCode === undefined ? "?" : String(record.exitCode), "yellow");
    raw(
      `  ${record.start.slice(5, 16).replace("T", " ")} ${
        record.cmd.padEnd(14)
      } exit=${exitLabel} ${dur}`,
    );
    raw(`    ${record.dir}`);
    const outcome = formatOutcome(record.outcome);
    if (outcome.length > 0) raw(`    ${outcome}`);
  }
}
