// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Pure verify-verdict interpretation for `giwt backup verify` (split from
 * the replay IO in verify.ts for the file-size budget). Everything here is
 * deterministic and unit-tested without spawning a single tool.
 */

import { type BackupArchive, type DumpLevel } from "./plan";

/** Manifest file giwt adds at every archive root (see dump-target.ts). */
export const MANIFEST_NAME = "backup-manifest.json";

/** Raw per-member replay evidence fed to the verdict interpreter. */
export interface MemberListing {
  archive: string;
  exitCode: number;
  entries: string[];
  timedOut?: string;
}

export interface ExtractFailure {
  archive: string;
  reason: string;
}

export interface VerifyInputs {
  /** Youngest chain in replay order; empty = nothing to replay. */
  chain: BackupArchive[];
  /** Base name tar was created with ("" for the repo-root target). */
  targetBase: string;
  listings: MemberListing[];
  extractFailures: ExtractFailure[];
  extractedManifest: boolean;
  /** Manifest exists on disk but is not the JSON giwt wrote. */
  manifestUnreadable: boolean;
  extractedTargetDir: boolean;
}

export interface VerifyVerdict {
  ok: boolean;
  reason?: string;
}

/** tar -t output → member entries (trimmed, blank lines dropped). */
export function parseTarListing(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Pure verdict from replay evidence. Order of complaints is stable so
 * reports are deterministic: chain presence → table failures → empty
 * tables → manifest in table → extraction failures → manifest on disk →
 * target tree on disk.
 */
export function interpretVerify(inputs: VerifyInputs): VerifyVerdict {
  if (inputs.chain.length === 0) {
    return { ok: false, reason: "no full archive found — nothing to replay" };
  }
  const failed = inputs.listings.find((l) => l.exitCode !== 0);
  if (failed !== undefined) {
    return {
      ok: false,
      reason: `tar -t failed on ${failed.archive}${
        failed.timedOut !== undefined ? ` (${failed.timedOut})` : ""
      }`,
    };
  }
  const empty = inputs.listings.find((l) => l.entries.length === 0);
  if (empty !== undefined) {
    return { ok: false, reason: `${empty.archive}: tar table is empty` };
  }
  const full = inputs.listings[0];
  if (full === undefined || !full.entries.includes(MANIFEST_NAME)) {
    return {
      ok: false,
      reason: `${MANIFEST_NAME} missing from the tar table of ${inputs.chain[0]!.archive}`,
    };
  }
  const extractFailure = inputs.extractFailures[0];
  if (extractFailure !== undefined) {
    return {
      ok: false,
      reason: `extraction failed at ${extractFailure.archive}: ${extractFailure.reason}`,
    };
  }
  if (!inputs.extractedManifest) {
    return { ok: false, reason: `${MANIFEST_NAME} missing after replay` };
  }
  if (inputs.manifestUnreadable) {
    return { ok: false, reason: `${MANIFEST_NAME} is not the manifest giwt wrote` };
  }
  if (inputs.targetBase !== "" && !inputs.extractedTargetDir) {
    return { ok: false, reason: `target tree ${inputs.targetBase}/ missing after replay` };
  }
  return { ok: true };
}

export interface TargetVerdict extends VerifyVerdict {
  target: string;
  chain: string[];
}

/** What dump writes into every archive root (MANIFEST_NAME). */
export interface BackupManifest {
  /** Original target path as dumped ("docs/api"; "." for the repo root). */
  target: string;
  level: DumpLevel;
  /** ISO timestamp of the dump run. */
  created: string;
}

/** Pure manifest parse; null when the JSON shape is not giwt's. */
export function parseManifest(text: string): BackupManifest | null {
  try {
    const value = JSON.parse(text) as Partial<BackupManifest> | null;
    if (
      value !== null && typeof value === "object" && typeof value.target === "string"
      && (value.level === "full" || value.level === "inc") && typeof value.created === "string"
    ) {
      return { target: value.target, level: value.level, created: value.created };
    }
    return null;
  } catch {
    return null;
  }
}
