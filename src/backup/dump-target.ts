// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Per-target dump step: authorization guard → level plan → sqlite quiesce →
 * tar → sha256 sidecar → zstd -t → atomic rename into the backup root.
 * Problems are RETURNED, never thrown, so one bad target doesn't abandon
 * the others; the caller decides the run verdict.
 */

import { copyFileSync, existsSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DumpRecord } from "./dump";
import { listArchives, newestFullMs, planNextLevel, safeTargetName, snarPath } from "./plan";
import { type QuiesceSkip, quiesceTarget } from "./quiesce";
import { buildTarPlan, freeArchiveName, sha256File, toolReason } from "./tarball";
import { type BackupManifest, MANIFEST_NAME } from "./verdict";
import { type BackupTool } from "./verify";

export interface StagedSnar {
  safe: string;
  stagingSnar: string;
  stateSnar: string;
}

export interface TargetStepResult {
  record: DumpRecord | null;
  staged: StagedSnar | null;
  problems: string[];
  skippedDbs: QuiesceSkip[];
}

/** Dump one target into staging and (on success) into the backup root. */
export async function dumpTarget(
  {
    target,
    targetAbs,
    rootAbs,
    staging,
    tool,
    runSqlite,
    sqliteAvailable,
    allowRootOwned,
    stamp,
    created,
    now,
    scratchRel,
  }: {
    target: string;
    targetAbs: string;
    rootAbs: string;
    staging: string;
    tool: BackupTool;
    runSqlite: (args: string[]) => Promise<{ exitCode: number; stderr: string; }>;
    sqliteAvailable: boolean;
    allowRootOwned: boolean;
    stamp: string;
    created: string;
    now: number;
    /** Scratch root relative to the repo root, or null when outside it. */
    scratchRel: string | null;
  },
): Promise<TargetStepResult> {
  const safe = safeTargetName(target);
  let uid = -1;
  try {
    uid = statSync(targetAbs).uid;
  } catch (err) {
    return step([], [`${target}: cannot stat target (${(err as Error).message})`]);
  }
  if (uid === 0 && !allowRootOwned) {
    return step([], [`${target}: owned by root — set [backup] allow_root_owned = true to dump it`]);
  }

  const stateSnar = snarPath(rootAbs, safe);
  const level = planNextLevel({
    snarExists: existsSync(stateSnar),
    youngestFullMs: newestFullMs(listArchives(rootAbs), safe),
    now,
  });
  const quiesced = await quiesceTarget({
    target: safe,
    targetAbs,
    staging,
    toolAvailable: sqliteAvailable,
    run: runSqlite,
  });

  const finalName = freeArchiveName(rootAbs, safe, level, stamp);
  const stagingSnar = join(staging, `${safe}.snar`);
  if (level === "inc") copyFileSync(stateSnar, stagingSnar);
  const manifest: BackupManifest = { target, level, created };
  writeFileSync(join(staging, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
  const archiveTmp = join(staging, finalName);
  const payloadTar = join(staging, `${finalName}.payload.tar`);
  const plan = buildTarPlan({
    payloadTar,
    archivePath: archiveTmp,
    stagingSnar,
    staging,
    rootAbs,
    targetAbs,
    snapshot: quiesced.snapshotDir === "" ? null : { dir: quiesced.snapshotDir, member: safe },
    dbRefs: quiesced.excluded.map((ref) => ({ rel: ref.rel })),
    scratchRel,
  });

  // Payload (chain driver) → appends (snapshots, manifest) → compress.
  // GNU tar allows only one -C with --listed-incremental, hence the split.
  const payload = await tool(plan.payload, staging);
  if (payload.exitCode !== 0) {
    return step(quiesced.skipped, [
      `${target}: tar exited ${payload.exitCode}${toolReason(payload)}`,
    ]);
  }
  for (const append of plan.appends) {
    const res = await tool(append, staging);
    if (res.exitCode !== 0) {
      return step(quiesced.skipped, [`${target}: tar append failed${toolReason(res)}`]);
    }
  }
  const compress = await tool(plan.compress, staging);
  if (compress.exitCode !== 0) {
    return step(quiesced.skipped, [`${target}: zstd compression failed${toolReason(compress)}`]);
  }
  rmSync(payloadTar, { force: true });

  const sha = sha256File(archiveTmp);
  const sidecarTmp = join(staging, `${finalName}.sha256`);
  writeFileSync(sidecarTmp, `${sha}  ${finalName}\n`);
  const integrity = await tool(["zstd", "-t", archiveTmp], staging);
  if (integrity.exitCode !== 0) {
    return step(quiesced.skipped, [
      `${target}: zstd -t failed on ${finalName}${toolReason(integrity)}`,
    ]);
  }

  // Atomic placement — the name was checked free, so rename never
  // overwrites an archive this run did not build.
  renameSync(archiveTmp, join(rootAbs, finalName));
  renameSync(sidecarTmp, join(rootAbs, `${finalName}.sha256`));
  return {
    record: {
      target,
      level,
      archive: finalName,
      bytes: statSync(join(rootAbs, finalName)).size,
      sha256: sha,
    },
    staged: { safe, stagingSnar, stateSnar },
    problems: [],
    skippedDbs: quiesced.skipped,
  };
}

function step(skippedDbs: QuiesceSkip[], problems: string[]): TargetStepResult {
  return { record: null, staged: null, problems, skippedDbs };
}
