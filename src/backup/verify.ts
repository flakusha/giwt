// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt backup verify` replay engine: extract the youngest full+increment
 * chain of each target into a scratch-area temp dir (full first, then
 * incrementals ascending, every extraction with
 * --listed-incremental=/dev/null so tar does not delete files per the
 * increments' metadata) and hand the collected evidence to the pure
 * verdict interpreter (verdict.ts).
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { type BackupArchive, listArchives, selectChain } from "./plan";
import { COMPRESS_PROGRAM } from "./tarball";
import {
  type BackupManifest,
  type ExtractFailure,
  interpretVerify,
  MANIFEST_NAME,
  type MemberListing,
  parseManifest,
  parseTarListing,
  type TargetVerdict,
  type VerifyInputs,
} from "./verdict";

/** Bounded tool spawn seam (production: boundedSpawn(defaultSpawn, budget)). */
export type BackupTool = (
  cmd: string[],
  cwd: string,
) => Promise<{ exitCode: number; stdout: string; stderr: string; timedOut?: string; }>;

function extractionArgs(archiveAbs: string, dest: string): string[] {
  return [
    "tar",
    `--use-compress-program=${COMPRESS_PROGRAM}`,
    "--extract",
    "--file",
    archiveAbs,
    "--directory",
    dest,
    // Restore idiom for listed-incremental members: a null snar disables
    // tar's delete-what-the-increment-doesn't-contain behavior.
    "--listed-incremental=/dev/null",
  ];
}

/**
 * Replay the youngest chain of every target (safe names) under `rootAbs`.
 * With `targets: []` every target found in the root is verified. Each
 * replay extracts into its own mkdtemp dir under `scratchRoot` — the
 * repo's scratch area (default .tmp), never /tmp root or another repo —
 * and is removed afterwards.
 */
export async function verifyRoot(
  { rootAbs, targets, tool, scratchRoot }: {
    rootAbs: string;
    /** Safe target names; empty = all targets with archives. */
    targets: string[];
    tool: BackupTool;
    /** Scratch area for replay temp dirs (created on demand). */
    scratchRoot: string;
  },
): Promise<TargetVerdict[]> {
  mkdirSync(scratchRoot, { recursive: true });
  const archives = listArchives(rootAbs);
  const present = [...new Set(archives.map((a) => a.target))].sort();
  const wanted = targets.length > 0
    ? targets.filter((t) => present.includes(t))
    : present;
  const verdicts: TargetVerdict[] = [];
  for (const target of wanted) {
    verdicts.push(await verifyTarget({ rootAbs, target, archives, tool, scratchRoot }));
  }
  // A target explicitly requested but with no archives at all must not
  // pass silently — report it as the empty-chain failure it is.
  for (const target of targets.filter((t) => !present.includes(t))) {
    verdicts.push({
      target,
      ok: false,
      reason: "no full archive found — nothing to replay",
      chain: [],
    });
  }
  return verdicts;
}

async function verifyTarget(
  { rootAbs, target, archives, tool, scratchRoot }: {
    rootAbs: string;
    target: string;
    archives: BackupArchive[];
    tool: BackupTool;
    scratchRoot: string;
  },
): Promise<TargetVerdict> {
  const chain = selectChain(archives, target);
  const tmp = mkdtempSync(join(scratchRoot, "giwt-backup-verify-"));
  try {
    return await replayChain({ rootAbs, target, chain, tool, tmp });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function replayChain(
  { rootAbs, target, chain, tool, tmp }: {
    rootAbs: string;
    target: string;
    chain: BackupArchive[];
    tool: BackupTool;
    tmp: string;
  },
): Promise<TargetVerdict> {
  const chainNames = chain.map((a) => a.archive);
  if (chain.length === 0) {
    return {
      target,
      ok: false,
      reason: "no full archive found — nothing to replay",
      chain: chainNames,
    };
  }
  const listings: MemberListing[] = [];
  const extractFailures: ExtractFailure[] = [];
  for (const member of chain) {
    const archiveAbs = join(rootAbs, member.archive);
    const table = await tool([
      "tar",
      `--use-compress-program=${COMPRESS_PROGRAM}`,
      "--list",
      "--file",
      archiveAbs,
    ], tmp);
    listings.push({
      archive: member.archive,
      exitCode: table.exitCode,
      entries: parseTarListing(table.stdout),
      ...(table.timedOut !== undefined ? { timedOut: table.timedOut } : {}),
    });
    const extract = await tool(extractionArgs(archiveAbs, tmp), tmp);
    if (extract.exitCode !== 0) {
      extractFailures.push({
        archive: member.archive,
        reason: extract.timedOut !== undefined
          ? extract.timedOut
          : `tar exited ${extract.exitCode}${
            extract.stderr.trim().length > 0 ? `: ${extract.stderr.trim()}` : ""
          }`,
      });
    }
  }
  const verdict = interpretVerify(
    replayEvidence({ tmp, chain, listings, extractFailures }),
  );
  return {
    target,
    ok: verdict.ok,
    ...(verdict.reason !== undefined ? { reason: verdict.reason } : {}),
    chain: chainNames,
  };
}

/** Post-replay disk evidence: manifest presence/shape + target tree. */
function replayEvidence(
  { tmp, chain, listings, extractFailures }: {
    tmp: string;
    chain: BackupArchive[];
    listings: MemberListing[];
    extractFailures: ExtractFailure[];
  },
): VerifyInputs {
  const manifestPath = join(tmp, MANIFEST_NAME);
  let manifest: BackupManifest | null = null;
  if (existsSync(manifestPath)) {
    try {
      manifest = parseManifest(readFileSync(manifestPath, "utf8"));
    } catch {
      manifest = null;
    }
  }
  // Target base comes from the extracted manifest (the safe archive name
  // cannot recover "docs/api" → "api"); the repo-root target (".")
  // extracts without its own directory.
  const targetBase = manifest === null || manifest.target === "."
    ? ""
    : basename(manifest.target);
  return {
    chain,
    targetBase,
    listings,
    extractFailures,
    extractedManifest: existsSync(manifestPath),
    manifestUnreadable: manifest === null && existsSync(manifestPath),
    extractedTargetDir: targetBase !== "" && existsSync(join(tmp, targetBase)),
  };
}
