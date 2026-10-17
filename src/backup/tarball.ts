// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tar-archive plumbing for the backup dump runner.
 *
 * GNU tar allows only ONE -C with --listed-incremental, so an archive is
 * built as a short command sequence against an uncompressed payload tar:
 * payload (single -C, the .snar chain driver) → appends (DB snapshots,
 * manifest; plain members, no -C limit) → zstd compression. Excludes are
 * MEMBER paths (tar stores -C-relative names), never absolute.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { type DumpLevel, stampMs, utcStamp } from "./plan";
import { MANIFEST_NAME } from "./verdict";

/** GNU-tar compress-program invocation: zstd, all cores (read and write). */
export const COMPRESS_PROGRAM = "zstd -T0";

/** The tar command sequence for one target, run in order. */
export interface TarPlan {
  /** Uncompressed payload: single -C + --listed-incremental (chain driver). */
  payload: string[];
  /** Plain --append commands (DB snapshots, manifest), in order. */
  appends: string[][];
  /** zstd compression of the payload into the final archive name. */
  compress: string[];
}

/** Assemble the tar command sequence for one target. */
export function buildTarPlan(
  { payloadTar, archivePath, stagingSnar, staging, rootAbs, targetAbs, snapshot, dbRefs }: {
    /** Uncompressed payload tar path (staging; removed after compress). */
    payloadTar: string;
    /** Final compressed archive path (staging; renamed into the root later). */
    archivePath: string;
    stagingSnar: string;
    staging: string;
    rootAbs: string;
    targetAbs: string;
    /** Snapshot dir to append (null when the target had no snapshottable DB). */
    snapshot: { dir: string; member: string; } | null;
    dbRefs: Array<{ rel: string; }>;
  },
): TarPlan {
  const base = basename(targetAbs);
  const member = (rel: string): string => (base === "." ? `./${rel}` : `${base}/${rel}`);
  const payload = [
    "tar",
    "--create",
    "--file",
    payloadTar,
    "--listed-incremental",
    stagingSnar,
  ];
  // Recursion guard: never archive the backup root (when the target
  // contains the root, its members would carry it).
  const guardRel = relative(targetAbs, rootAbs);
  if (guardRel !== "" && !guardRel.startsWith("..")) {
    payload.push("--exclude", member(guardRel), "--exclude", `${member(guardRel)}/*`);
  }
  for (const db of dbRefs) payload.push("--exclude", member(db.rel));
  payload.push("-C", dirname(targetAbs), base);

  const appends: string[][] = [];
  if (snapshot !== null) {
    // The quiesce dir accumulates per-target subdirs during a run; the
    // transform nests ONLY this target's subtree under _giwt-quiesced/ so
    // archive members can never collide with a target's own tree.
    appends.push([
      "tar",
      "--append",
      "--file",
      payloadTar,
      "-C",
      snapshot.dir,
      "--transform=s,^,_giwt-quiesced/,",
      snapshot.member,
    ]);
  }
  appends.push(["tar", "--append", "--file", payloadTar, "-C", staging, MANIFEST_NAME]);

  const compress = ["zstd", "--quiet", "--force", payloadTar, "-o", archivePath];
  return { payload, appends, compress };
}

/** sha256 of one file (in-process; no extra spawn to bound). */
export function sha256File(path: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(readFileSync(path));
  return hasher.digest("hex");
}

/** Stamp bumped by whole seconds until the archive name is free — an
 *  existing archive is never overwritten, even by a same-second re-run. */
export function freeArchiveName(
  rootAbs: string,
  safe: string,
  level: DumpLevel,
  stamp: string,
): string {
  let name = `${safe}.${level}.${stamp}.tar.zst`;
  let extraSecs = 0;
  while (existsSync(join(rootAbs, name))) {
    extraSecs++;
    name = `${safe}.${level}.${utcStamp(new Date(stampMs(stamp) + extraSecs * 1000))}.tar.zst`;
  }
  return name;
}

/** Stderr tail / timeout suffix for a failed tool invocation. */
export function toolReason(res: { stderr: string; timedOut?: string; }): string {
  if (res.timedOut !== undefined) return ` (${res.timedOut})`;
  const err = res.stderr.trim();
  return err.length > 0 ? `: ${err}` : "";
}
