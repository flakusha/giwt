// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
// Compile-time surface check: every new public symbol must resolve from
// "giwt". The package import is type-only on purpose — a runtime import of
// "giwt" would pull the whole CLI graph into the coverage lcov and regress
// the committed baseline; `tsc --noEmit` still checks every resolution.
import type {
  AnnexCounts,
  BackupEvent,
  BackupKind,
  BackupType,
  classifyGit as classifyGitPublic,
  ClassifyGitArgs,
  ClassifyOptions,
  DumpOptions,
  DumpPreviewRow,
  DumpRecord,
  DumpRunResult,
  GitPolicyLists,
  GitVerdict,
  lastSuccessMs as lastSuccessMsPublic,
  lastSuccessRow as lastSuccessRowPublic,
  parseDuration as parseDurationPublic,
  readState as readStatePublic,
  RemoteOptions,
  ResolvedTarget,
  runDump as runDumpPublic,
  runRemoteCommand as runRemoteCommandPublic,
  runScheduleCommand as runScheduleCommandPublic,
  runStatusCommand as runStatusCommandPublic,
  ScheduleOptions,
  stalenessAlert as stalenessAlertPublic,
  StalenessVerdict,
  stalenessVerdict as stalenessVerdictPublic,
  StatusOptions,
  successes as successesPublic,
  TargetVerdict,
  TarPlan,
  verifyRoot as verifyRootPublic,
  VerifyVerdict,
} from "giwt";
// Runtime behavior comes from the subjects' own modules (already covered);
// the `*Public` type aliases prove the same symbols resolve from the package
// root and stay assignment-compatible with the deep implementations.
import { annexCounts } from "./backup/annex-status";
import { previewDump, runDump } from "./backup/dump";
import { runRemoteCommand, runScheduleCommand, runStatusCommand } from "./backup/orchestrate";
import {
  lastSuccessMs,
  lastSuccessRow,
  parseDuration,
  readState,
  stalenessAlert,
  stalenessVerdict,
  successes,
} from "./backup/state";
import { verifyRoot } from "./backup/verify";
// The positional primitive stays internal to the repo (grandfathered seam).
import { classifyGit, classifyGitInvocation } from "./git/policy";
type Kinds = [
  GitVerdict,
  GitPolicyLists,
  ClassifyGitArgs,
  ClassifyOptions,
  AnnexCounts,
  BackupEvent,
  BackupKind,
  BackupType,
  StalenessVerdict,
  DumpOptions,
  DumpPreviewRow,
  DumpRecord,
  DumpRunResult,
  ResolvedTarget,
  TarPlan,
  TargetVerdict,
  VerifyVerdict,
  StatusOptions,
  ScheduleOptions,
  RemoteOptions,
];
const typeSurface: Kinds = [
  null as unknown as GitVerdict,
  null as unknown as GitPolicyLists,
  null as unknown as ClassifyGitArgs,
  null as unknown as ClassifyOptions,
  null as unknown as AnnexCounts,
  null as unknown as BackupEvent,
  null as unknown as BackupKind,
  null as unknown as BackupType,
  null as unknown as StalenessVerdict,
  null as unknown as DumpOptions,
  null as unknown as DumpPreviewRow,
  null as unknown as DumpRecord,
  null as unknown as DumpRunResult,
  null as unknown as ResolvedTarget,
  null as unknown as TarPlan,
  null as unknown as TargetVerdict,
  null as unknown as VerifyVerdict,
  null as unknown as StatusOptions,
  null as unknown as ScheduleOptions,
  null as unknown as RemoteOptions,
];

// Compile-time identity: `*Public` (resolved from "giwt") must be assignable
// to the deep implementation's typeof — fails tsc if a public export drifts
// or disappears.
const publicIdentity: [
  typeof runDumpPublic,
  typeof verifyRootPublic,
  typeof runStatusCommandPublic,
  typeof runScheduleCommandPublic,
  typeof runRemoteCommandPublic,
  typeof classifyGitPublic,
  typeof readStatePublic,
  typeof successesPublic,
  typeof lastSuccessMsPublic,
  typeof lastSuccessRowPublic,
  typeof stalenessVerdictPublic,
  typeof stalenessAlertPublic,
  typeof parseDurationPublic,
] = [
  runDump,
  verifyRoot,
  runStatusCommand,
  runScheduleCommand,
  runRemoteCommand,
  classifyGit,
  readState,
  successes,
  lastSuccessMs,
  lastSuccessRow,
  stalenessVerdict,
  stalenessAlert,
  parseDuration,
];

describe("public API surface (giwt)", () => {
  test("runner and reader symbols resolve from the package root", () => {
    for (
      const fn of [
        classifyGit,
        classifyGitInvocation,
        previewDump,
        runDump,
        verifyRoot,
        runStatusCommand,
        runScheduleCommand,
        runRemoteCommand,
        readState,
        successes,
        lastSuccessMs,
        lastSuccessRow,
        stalenessVerdict,
        stalenessAlert,
        parseDuration,
        annexCounts,
      ]
    ) {
      expect(typeof fn).toBe("function");
    }
    expect(typeSurface.length).toBe(20);
    expect(publicIdentity.length).toBe(13);
  });

  test("wrapper verdicts match the positional classifier (incl. custom pathExists)", () => {
    const lists: GitPolicyLists = { safe: [], allow: [], deny: [] };
    const argvs: readonly string[][] = [
      ["status"],
      ["push", "--force"],
      ["annex", "drop", "somekey"],
      ["checkout", "src"],
      ["--no-gpg-sign", "commit", "-m", "x"],
    ];
    const probes: ClassifyOptions[] = [
      {},
      { pathExists: () => false },
      { pathExists: () => true },
    ];
    for (const args of argvs) {
      for (const options of probes) {
        expect(classifyGit({ args, lists, options })).toEqual(
          classifyGitInvocation(args, lists, options),
        );
      }
    }
  });

  test("checkout of an existing entry blocks through both forms (custom pathExists)", () => {
    const options: ClassifyOptions = { pathExists: () => true };
    expect(classifyGit({ args: ["checkout", "src"], options }).verdict).toBe("block");
    expect(classifyGitInvocation(["checkout", "src"], undefined, options).verdict).toBe(
      "block",
    );
  });

  test("block verdicts survive the public API (destructive annex op, no allow)", () => {
    const v = classifyGit({ args: ["annex", "drop", "somekey"] });
    expect(v.verdict).toBe("block");
  });
});
