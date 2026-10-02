// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Three-way JSON merge for generated index files: values equal on both
 * sides pass through, one-sided edits win, arrays union, objects merge
 * recursively, and genuinely competing edits are recorded as conflicts
 * (rebase-side value kept).
 */

type JsonRecord = Record<string, unknown>;

export interface JsonMergeResult {
  value: JsonRecord;
  conflicts: string[];
}

export function asRecord(value: string): JsonRecord {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as JsonRecord
      : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function unionValues(left: unknown[], right: unknown[]): unknown[] {
  const values: unknown[] = [];
  for (const value of [...left, ...right]) {
    if (!values.some((existing) => sameValue(existing, value))) values.push(value);
  }
  return values;
}

function mergeValue(
  base: unknown,
  ours: unknown,
  theirs: unknown,
  path: string,
  conflicts: string[],
): unknown {
  if (sameValue(ours, theirs)) return ours;
  if (sameValue(base, ours)) return theirs;
  if (sameValue(base, theirs)) return ours;
  if (Array.isArray(ours) && Array.isArray(theirs)) return unionValues(ours, theirs);
  if (isRecord(ours) && isRecord(theirs)) {
    const merged: JsonRecord = {};
    const keys = new Set([
      ...Object.keys(isRecord(base) ? base : {}),
      ...Object.keys(ours),
      ...Object.keys(theirs),
    ]);
    for (const key of keys) {
      merged[key] = mergeValue(
        isRecord(base) ? base[key] : undefined,
        ours[key],
        theirs[key],
        `${path}.${key}`,
        conflicts,
      );
    }
    return merged;
  }
  conflicts.push(path);
  return ours;
}

export function mergeIndexRecords(
  base: JsonRecord,
  ours: JsonRecord,
  theirs: JsonRecord,
): JsonMergeResult {
  const conflicts: string[] = [];
  return {
    value: mergeValue(base, ours, theirs, "index", conflicts) as JsonRecord,
    conflicts,
  };
}
