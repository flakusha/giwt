// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Intercom retention (`giwt intercom gc`): dry-run by default, `--apply`
 * to mutate. Binding policy:
 * - FIXED-* files older than `fixedArchiveDays` (14) → `archive/` (evidence
 *   kept, board decluttered);
 * - closed LANE-* claims older than `laneStaleDays` (30) → stamped stale
 *   (idempotent marker line);
 * - the event stream compacted to its newest `eventKeep` (1000) events;
 *   the pijul backend retires by unrecord (see backend-pijul.ts);
 * - orphaned stores (path-keyed, repo dir gone) swept from the state root.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { backendFor } from "./backend";
import { eventLineCount } from "./backend-jsonl";
import { agentIdentity } from "./ids";
import { FIXED_PREFIX, type IntercomRetention, LANE_PREFIX, STALE_MARK } from "./types";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface GcPlan {
  /** FIXED files moving to archive/ (basename, ageDays). */
  archived: Array<{ name: string; ageDays: number; }>;
  /** Closed-but-aged LANE files to stamp stale (basename, ageDays). */
  stamped: Array<{ name: string; ageDays: number; }>;
  /** Event-stream compaction: current → after line counts. */
  eventsBefore: number;
  eventsAfter: number;
  /** Orphaned stores under the state root (dirName, why). */
  orphans: Array<{ name: string; why: string; }>;
}

function ageDays(path: string, nowMs: number): number {
  try {
    return Math.max(0, Math.floor((nowMs - statSync(path).mtimeMs) / DAY_MS));
  } catch {
    return -1;
  }
}

/**
 * Compute the retention plan for one store (+ sibling stores for orphans).
 * Pure-ish: reads the filesystem, mutates nothing.
 */
export function planGc(
  storeDir: string,
  stateRoot: string,
  retention: IntercomRetention,
  nowMs: number = Date.now(),
): GcPlan {
  const archived: GcPlan["archived"] = [];
  const stamped: GcPlan["stamped"] = [];
  let names: string[] = [];
  try {
    names = readdirSync(storeDir);
  } catch {
    /* store vanished — empty plan */
  }
  const archiveDir = join(storeDir, "archive");
  for (const name of names) {
    const path = join(storeDir, name);
    if (name.startsWith(FIXED_PREFIX) && name.endsWith(".md")) {
      const age = ageDays(path, nowMs);
      if (age >= retention.fixedArchiveDays && !existsSync(join(archiveDir, name))) {
        archived.push({ name, ageDays: age });
      }
    } else if (name.startsWith(LANE_PREFIX) && name.endsWith(".md")) {
      const stem = name.slice(LANE_PREFIX.length, -".md".length);
      const closed = existsSync(join(storeDir, `${FIXED_PREFIX}${stem}.md`));
      if (!closed) continue;
      const age = ageDays(path, nowMs);
      if (age >= retention.laneStaleDays && !isStamped(path)) {
        stamped.push({ name, ageDays: age });
      }
    }
  }
  const eventsBefore = eventLineCount(storeDir);
  const eventsAfter = Math.min(eventsBefore, Math.max(0, retention.eventKeep));
  return {
    archived,
    stamped,
    eventsBefore,
    eventsAfter,
    orphans: planOrphans(stateRoot, nowMs),
  };
}

function isStamped(path: string): boolean {
  try {
    return readFileSync(path, "utf8").includes(STALE_MARK);
  } catch {
    return true; // unreadable: never stamp blindly
  }
}

/** Path-keyed stores whose recorded repo dir no longer exists. */
function planOrphans(stateRoot: string, _nowMs: number): GcPlan["orphans"] {
  const out: GcPlan["orphans"] = [];
  let dirs: string[] = [];
  try {
    dirs = readdirSync(stateRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) =>
      d.name
    );
  } catch {
    return out;
  }
  for (const name of dirs) {
    const dir = join(stateRoot, name);
    let meta: { kind?: string; repoPath?: string; };
    try {
      meta = JSON.parse(readFileSync(join(dir, "project.json"), "utf8")) as typeof meta;
    } catch {
      continue; // not a project store (archive/, foreign dir) — skip
    }
    if (meta.kind === "path" && typeof meta.repoPath === "string" && !existsSync(meta.repoPath)) {
      out.push({ name, why: `repo gone: ${meta.repoPath}` });
    }
  }
  return out;
}

/**
 * Apply a gc plan. Fixed files rename into `archive/`, stale stamps append
 * the marker line, the event stream compacts via the backend (pijul
 * retires by unrecord), orphan stores move under `<stateRoot>/archive/`.
 * The compaction runs BEFORE the gc event is appended so the summary
 * event itself always survives as the newest line.
 */
export function applyGc(
  storeDir: string,
  stateRoot: string,
  backendName: "jsonl" | "pijul",
  retention: IntercomRetention,
  plan: GcPlan,
): void {
  const archiveDir = join(storeDir, "archive");
  for (const item of plan.archived) {
    renameSync(join(storeDir, item.name), join(archiveDir, item.name));
  }
  for (const item of plan.stamped) {
    const path = join(storeDir, item.name);
    writeFileSync(
      path,
      `${readFileSync(path, "utf8")}<!-- ${STALE_MARK} ${new Date().toISOString()} -->\n`,
    );
  }
  const backend = backendFor(backendName);
  backend.retireEvents(storeDir, retention.eventKeep);
  backend.appendEvent(storeDir, {
    actor: agentIdentity(),
    type: "gc",
    lane: "",
    refs: [],
    body:
      `archived ${plan.archived.length}, stamped ${plan.stamped.length}, events ${plan.eventsBefore}->${plan.eventsAfter}, orphans ${plan.orphans.length}`,
  });
  if (plan.orphans.length > 0) {
    const orphanArchive = join(stateRoot, "archive");
    mkdirSync(orphanArchive, { recursive: true });
    for (const orphan of plan.orphans) {
      try {
        renameSync(join(stateRoot, orphan.name), join(orphanArchive, orphan.name));
      } catch {
        /* raced away or target exists — leave it for the next gc */
      }
    }
  }
}
