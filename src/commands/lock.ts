// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt lock` — advisory preflight for the finalize lock + check-fanout
 * slots (FEAT-advisory-giwt-lock-status-command). READ-ONLY: it never
 * acquires the lock, takes a slot, or creates any file/directory — it
 * gates nothing; it only answers "is finalize in-flight / is the queue
 * deep / are check slots starved?" before a 10-minute gate storm.
 *
 * Composes existing primitives: LOCK_FILENAME + the holder/age readers
 * behind `reportHeldLock` (finalize/lock-report.ts), the FIFO queue dir
 * `<lockfile>.queue/`, and `checkSlotDir`/`checkSlotCapacity` (utils/
 * check-slots.ts). Slot dirs carry no holder identity, so stale-slot
 * detection is impossible read-only; the documented manual recovery
 * (`rm -rf` the slot root) is printed when slots are in use.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { freemem } from "node:os";
import { resolve } from "node:path";
import { checkSlotCapacity, checkSlotDir } from "../utils/check-slots";
import type { WorktreeConfig } from "../utils/config";
import { renderRecords } from "../utils/emit";
import { log, outcomeLine, raw } from "../utils/output";
import { LOCK_FILENAME } from "./abort/helpers";
import { formatLockAge, pidAlive } from "./finalize/lock-report";

export interface LockReport {
  finalize: "held" | "free";
  holderPid?: number;
  holderAlive?: boolean;
  holderAge?: string;
  queueDepth: number;
  checkSlotsUsed: number;
  checkSlotsCapacity: number;
}

/** Holder PID from the lockfile, or null (missing/empty/unreadable). */
function readHolderPid(lockPath: string): number | null {
  try {
    const parsed = parseInt(readFileSync(lockPath, "utf8").trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Lock age in ms from the lockfile mtime, or null when unreadable. */
function lockAgeMs(lockPath: string, now: number): number | null {
  try {
    return now - statSync(lockPath).mtimeMs;
  } catch {
    return null;
  }
}

/** FIFO ticket count in `<lockfile>.queue/` (0 when absent). */
function queueDepth(lockPath: string): number {
  const dir = `${lockPath}.queue`;
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).length;
  } catch {
    return 0;
  }
}

/** Used capacity-indexed check-slot dirs (0 when the slot root is absent). */
function usedSlots(dir: string): number {
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).length;
  } catch {
    return 0;
  }
}

/** Gather the advisory facts. Pure reads — creates/mutates nothing. */
export function collectLockReport(config: WorktreeConfig, now: number = Date.now()): LockReport {
  const lockPath = resolve(config.repoRoot, LOCK_FILENAME);
  const held = existsSync(lockPath);
  const holderPid = held ? readHolderPid(lockPath) : null;
  const ageMs = held ? lockAgeMs(lockPath, now) : null;
  const budgetMb = config.settings.doctor.memoryBudgetMb;
  const availableMemMb = budgetMb > 0 ? budgetMb : Math.floor(freemem() / 2 ** 20);
  return {
    finalize: held ? "held" : "free",
    ...(holderPid !== null ? { holderPid } : {}),
    ...(holderPid !== null ? { holderAlive: pidAlive(holderPid) } : {}),
    ...(holderPid !== null && ageMs !== null ? { holderAge: formatLockAge(ageMs) } : {}),
    queueDepth: held ? queueDepth(lockPath) : 0,
    checkSlotsUsed: usedSlots(checkSlotDir()),
    checkSlotsCapacity: checkSlotCapacity(availableMemMb),
  };
}

function printHelp(): void {
  raw("Usage: giwt lock [--json|--toml|--emoji]");
  raw("  Advisory finalize lock + check-slot status. Read-only: it never");
  raw("  acquires the lock or takes a slot and gates nothing.");
  raw("  finalize      held/free; holder PID + alive + age when held");
  raw("  queue         FIFO ticket depth (<lockfile>.queue/)");
  raw("  check-slots   used/capacity (capacity: [doctor] memory_budget_mb or free RAM)");
}

function formatFlag(args: string[]): "json" | "toml" | "emoji" | "human" {
  if (args.includes("--json")) return "json";
  if (args.includes("--toml")) return "toml";
  if (args.includes("--emoji")) return "emoji";
  return "human";
}

function emojiLine(record: unknown): string {
  const r = record as LockReport;
  return `🔒 finalize ${r.finalize}, queue ${r.queueDepth}, slots ${r.checkSlotsUsed}/${r.checkSlotsCapacity}`;
}

export async function lock(args: string[], config: WorktreeConfig): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  const unknown = args.filter((a) => a !== "--json" && a !== "--toml" && a !== "--emoji");
  if (unknown.length > 0) {
    log("error", `unknown flag '${unknown[0]}'`);
    printHelp();
    process.exit(1);
  }
  const format = formatFlag(args);
  const report = collectLockReport(config);

  if (format !== "human") {
    raw(renderRecords(report, format, { emoji: emojiLine }));
    return;
  }

  raw(`finalize: ${report.finalize}`);
  if (report.holderPid !== undefined) {
    const alive = report.holderAlive ? "alive" : "dead";
    raw(`holder: PID ${report.holderPid} (${alive}), age ${report.holderAge ?? "unknown"}`);
    if (report.holderAlive === false) {
      raw(
        `stale: holder is dead — 'giwt abort', or remove ${
          resolve(config.repoRoot, LOCK_FILENAME)
        }`,
      );
    }
  }
  raw(`queue: ${report.queueDepth} waiting`);
  raw(`check-slots: ${report.checkSlotsUsed}/${report.checkSlotsCapacity} used`);
  if (report.checkSlotsUsed > 0) {
    raw(`recovery: rm -rf ${checkSlotDir()} (a crashed holder narrows capacity until then)`);
  }
  outcomeLine(
    true,
    `finalize ${report.finalize}, queue ${report.queueDepth}, slots ${report.checkSlotsUsed}/${report.checkSlotsCapacity}`,
  );
}
