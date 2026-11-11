// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Lane claim files — the atomic coordination layer.
 *
 * A claim is an `O_EXCL` create of `LANE-<lane>.md` inside the store: the
 * kernel arbitrates, so a double claim fails loudly even across processes
 * (the whole point — the scratch era had no CAS at all). Completion writes
 * `FIXED-<lane>.md`, also O_EXCL. Both layers are plain files so the
 * sandboxed-agent path (write through the `.tmp/intercom` link) and the
 * CLI path produce identical bytes.
 *
 * Lane names must be filename-safe: `^[A-Za-z0-9][A-Za-z0-9._-]*$`, no
 * separators, 1–80 chars — the lane rides in the filename.
 */

import { closeSync, existsSync, openSync, readFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { FIXED_PREFIX, LANE_PREFIX } from "./types";

export const LANE_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

/** Validate + return the lane name; throws with the allowed shape. */
export function checkLaneName(lane: string): string {
  if (!LANE_OK.test(lane)) {
    throw new Error(
      `intercom: invalid lane name '${lane}' — want [A-Za-z0-9][A-Za-z0-9._-]* (max 80, no separators)`,
    );
  }
  return lane;
}

/** True when a claim/release file for the lane exists in the store. */
export function hasClaim(storeDir: string, lane: string): boolean {
  return existsSync(join(storeDir, `${LANE_PREFIX}${lane}.md`));
}

/** True when a completion report for the lane exists in the store. */
export function hasFixed(storeDir: string, lane: string): boolean {
  return existsSync(join(storeDir, `${FIXED_PREFIX}${lane}.md`));
}

/**
 * Claim a lane: O_EXCL-create `LANE-<lane>.md`. Returns the claim file
 * path; throws when the lane is already claimed (EEXIST) — the loud
 * double-claim failure the scratch era never had.
 */
export function claimLane(storeDir: string, lane: string, owner: string, scope?: string): string {
  const path = join(storeDir, `${LANE_PREFIX}${lane}.md`);
  const body = [
    `# LANE: ${lane}`,
    `owner=${owner}`,
    ...(scope !== undefined && scope.length > 0 ? [`scope=${scope}`] : []),
    `date=${new Date().toISOString().replace(/\.\d+Z$/, "Z")}`,
    "",
  ].join("\n");
  let fd: number;
  try {
    fd = openSync(path, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `intercom: lane '${lane}' is already claimed (${path})${
          claimOwner(path) === null ? "" : ` by ${claimOwner(path)}`
        } — pick another lane or wait for it to finish`,
        { cause: error },
      );
    }
    throw error;
  }
  try {
    writeSync(fd, body);
  } finally {
    closeSync(fd);
  }
  return path;
}

/** `owner=` line of an existing claim file; null when unreadable/absent. */
function claimOwner(claimPath: string): string | null {
  try {
    const line = readFileSync(claimPath, "utf8").split("\n").find((l) => l.startsWith("owner="));
    const value = line?.slice("owner=".length).trim();
    return value !== undefined && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Record completion: O_EXCL-create `FIXED-<lane>.md` with a stub header
 * plus the given note and/or the contents of a detail file (embedded, so
 * the evidence survives the detail file's scratch dir). Throws when the
 * lane was already completed.
 */
export function writeFixed(
  storeDir: string,
  lane: string,
  opts: { owner: string; note?: string; detailPath?: string; },
): string {
  const path = join(storeDir, `${FIXED_PREFIX}${lane}.md`);
  let detail = "";
  if (opts.detailPath !== undefined) {
    try {
      detail = readFileSync(opts.detailPath, "utf8");
    } catch (error) {
      throw new Error(
        `${opts.detailPath}: unreadable detail file (${(error as Error).message})`,
        { cause: error },
      );
    }
  }
  const body = [
    `# FIXED: ${lane}`,
    `owner=${opts.owner}`,
    `date=${new Date().toISOString().replace(/\.\d+Z$/, "Z")}`,
    ...(opts.note !== undefined && opts.note.length > 0 ? [``, opts.note] : []),
    ...(detail.length > 0 ? [``, `## Detail`, ``, detail] : []),
    "",
  ].join("\n");
  let fd: number;
  try {
    fd = openSync(path, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`intercom: lane '${lane}' already has a completion report (${path})`, {
        cause: error,
      });
    }
    throw error;
  }
  try {
    writeSync(fd, body);
  } finally {
    closeSync(fd);
  }
  return path;
}
