// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Defensive reader for `pijul pull --json` conflict output. Pijul emits
 * `{"conflicts":[{"kind","path"[,"line"]}]}`; unexpected shapes, unknown keys
 * and malformed text are ignored rather than thrown.
 */

export interface PijulConflict {
  kind: string;
  path: string;
  line?: number;
}

type Bag = Record<string, unknown>;

function bag(value: unknown): Bag | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Bag
    : null;
}

function readConflict(value: unknown): PijulConflict | null {
  const obj = bag(value);
  if (obj === null || typeof obj.kind !== "string" || typeof obj.path !== "string") return null;
  const raw = obj.line;
  const line = typeof raw === "number" && Number.isInteger(raw)
    ? raw
    : typeof raw === "string" && /^\d+$/.test(raw)
    ? Number(raw)
    : undefined;
  return {
    kind: obj.kind,
    path: obj.path,
    ...(line !== undefined ? { line } : {}),
  };
}

export function parsePullConflicts(stdout: string): PijulConflict[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (Array.isArray(parsed)) {
    return parsed.map(readConflict).filter((c): c is PijulConflict => c !== null);
  }
  const root = bag(parsed);
  const raw = root?.conflicts;
  const bagOfConflicts = bag(raw);
  const list = Array.isArray(raw)
    ? raw
    : bagOfConflicts === null
    ? []
    : Object.values(bagOfConflicts);
  return list.map(readConflict).filter((c): c is PijulConflict => c !== null);
}

/** Line-anchored pijul conflict markers, used when output is not structured JSON. */
const CONFLICT_MARKER = /^(?:<{7}|>{7})(?:\s|$)/m;

/** True when structured conflicts or conflict markers are present in the output. */
export function hasUnresolvedConflicts(stdout: string): boolean {
  return parsePullConflicts(stdout).length > 0 || CONFLICT_MARKER.test(stdout);
}
