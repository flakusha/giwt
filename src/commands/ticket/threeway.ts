// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "path";
import type { WorktreeConfig } from "../../utils/config";
import { parseOutFlags, renderRecords } from "../../utils/emit";
import { gitSync, isolatedGitEnv } from "../../utils/git";
import { log, raw } from "../../utils/output";
import { scratchRoot } from "../../utils/scratch-tmp";

const STAGE_LABELS = ["BASE", "OURS", "THEIRS"] as const;

/** One conflict stage, for machine output. */
export interface StageRecord {
  kind: "stage";
  label: string;
  sha?: string;
  bytes: number;
}

/** One pairwise verdict, for machine output. */
export interface VerdictRecord {
  kind: "verdict";
  pair: string;
  verdict: string;
}

/** Raw blob content + byte size, or null when the object is unreadable. */
function readBlob(root: string, sha: string): { content: string; bytes: number; } | null {
  const result = Bun.spawnSync(["git", "-C", root, "cat-file", "-p", sha], {
    stdout: "pipe",
    stderr: "pipe",
    env: isolatedGitEnv(),
  });
  if (result.exitCode !== 0) return null;
  return { content: result.stdout.toString("utf8"), bytes: result.stdout.byteLength };
}

/** Unified-diff hunk count between two strings via `git diff --no-index`
 * on temp files; equal inputs short-circuit to 0. Exported for tests —
 * a real three-way conflict never yields an 'identical' pair. */
export function hunkCount(a: string, b: string): number {
  if (a === b) return 0;
  const dir = mkdtempSync(join(scratchRoot(), "giwt-3way-"));
  try {
    writeFileSync(join(dir, "a"), a);
    writeFileSync(join(dir, "b"), b);
    // Exit code 1 means "differences found" — expected, not an error.
    const result = Bun.spawnSync(["git", "-C", dir, "diff", "--no-index", "--", "a", "b"], {
      stdout: "pipe",
      stderr: "pipe",
      env: isolatedGitEnv(),
    });
    return result.stdout.toString("utf8").split("\n").filter((l) => l.startsWith("@@")).length;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function pairVerdict(a: string, b: string): string {
  const hunks = hunkCount(a, b);
  return hunks === 0 ? "identical" : `changed (${hunks} hunks)`;
}

function threeWayEmoji(record: unknown): string {
  const rec = record as StageRecord | VerdictRecord;
  if (rec.kind === "stage") {
    return `📄 ${rec.label} ${rec.sha ?? "(absent)"} (${rec.bytes}b)`;
  }
  return `${rec.verdict === "identical" ? "🟢" : "🟡"} ${rec.pair}: ${rec.verdict}`;
}

/** `giwt ticket 3way <path>` — print the three conflict stages of an
 * unmerged ticket path side by side (BASE/OURS/THEIRS with blob content)
 * plus a changed/identical verdict per pair. Stages come from the
 * invoking worktree's index (conflict state is per-worktree); blob
 * objects resolve through the shared store. */
export async function threeWay(args: string[], config: WorktreeConfig): Promise<void> {
  const { format, rest } = parseOutFlags(args);
  const input = rest[0];
  if (!input) {
    log("error", "unmerged path required");
    raw("  Usage: ticket 3way <path> [--json|--toml|--emoji]");
    process.exit(1);
  }
  const file = resolve(config.worktreeRoot, input);
  const rel = relative(config.worktreeRoot, file);
  if (rel.startsWith("..")) {
    throw new Error(`${input}: outside checkout ${config.worktreeRoot}`);
  }

  const shas = new Map<number, string>();
  for (const line of gitSync(config.worktreeRoot, "ls-files", "-u", "--", rel).split("\n")) {
    const m = line.match(/^[0-7]{6} ([0-9a-f]{7,40}) ([123])\t/);
    if (m?.[1] && m[2]) shas.set(Number(m[2]), m[1]);
  }
  if (shas.size === 0) {
    throw new Error(`${rel}: not unmerged (no conflict stages in the index)`);
  }

  const stages = STAGE_LABELS.map((label, i) => {
    const sha = shas.get(i + 1) ?? null;
    const blob = sha === null ? null : readBlob(config.worktreeRoot, sha);
    return {
      label,
      sha,
      bytes: blob?.bytes ?? 0,
      content: blob?.content ?? "(absent)",
    };
  });
  const [base, ours, theirs] = stages;
  const verdicts = [
    { pair: "ours-vs-base", verdict: pairVerdict(ours!.content, base!.content) },
    { pair: "theirs-vs-base", verdict: pairVerdict(theirs!.content, base!.content) },
    { pair: "ours-vs-theirs", verdict: pairVerdict(ours!.content, theirs!.content) },
  ];

  if (format === "json" || format === "toml" || format === "emoji") {
    const records: Array<StageRecord | VerdictRecord> = [
      ...stages.map((s): StageRecord => (
        { kind: "stage", label: s.label, bytes: s.bytes, ...(s.sha ? { sha: s.sha } : {}) }
      )),
      ...verdicts.map((v): VerdictRecord => ({
        kind: "verdict",
        pair: v.pair,
        verdict: v.verdict,
      })),
    ];
    raw(renderRecords(records, format, { emoji: threeWayEmoji }));
    return;
  }

  for (const stage of stages) {
    raw(`── ${stage.label} ${stage.sha ?? "(absent)"} (${stage.bytes} bytes)`);
    raw(stage.content);
  }
  for (const v of verdicts) {
    raw(`${v.pair}: ${v.verdict}`);
  }
}
