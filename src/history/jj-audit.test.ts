// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/** Tests for the colocated-jj history audit. Git plumbing runs against a real
 * scratch repo; the jj change-ID lookup is an injected stub, so no jj binary
 * is required. */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isolatedGitEnv } from "../utils/git";
import { scratchRoot } from "../utils/scratch-tmp";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { auditJjHistory } from "./jj-audit";
import type { JjHistorySpawn } from "./jj-history";

const temps: string[] = [];
const DEFAULTS = DEFAULT_SETTINGS.audit;

function git(root: string, args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", root, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: isolatedGitEnv(),
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

function commit(root: string, path: string, message: string): void {
  writeFileSync(join(root, path), `${message}\n`);
  git(root, ["add", path]);
  git(root, ["commit", "-qm", message]);
}

function makeRepo(): string {
  const root = mkdtempSync(join(scratchRoot(), "giwt-jj-audit-"));
  temps.push(root);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "giwt-test@localhost"]);
  git(root, ["config", "user.name", "giwt test"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  commit(root, "base.txt", "base");
  return root;
}

/** Emits pairs only for shas named in commit_id(...) revsets, mirroring how
 * all() hides rewritten commits while explicit commit_id() resolves them. */
function jjStub(bySha: Record<string, string>) {
  const calls: string[][] = [];
  const spawn: JjHistorySpawn = (cmd) => {
    calls.push([...cmd]);
    const revset = cmd[cmd.indexOf("-r") + 1] ?? "";
    const requested = [...revset.matchAll(/commit_id\(([0-9a-f]+)\)/g)].map((m) => m[1]!);
    const body = requested
      .filter((sha) => bySha[sha] !== undefined)
      .map((sha) => `${sha}\x1f${bySha[sha]}`)
      .join("\n");
    return { stdout: body === "" ? "" : `${body}\n`, stderr: "", exitCode: 0 };
  };
  return { spawn, calls };
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("auditJjHistory (stubbed jj change ids)", () => {
  test("a rewritten commit keeps its change ID across two commit ids", () => {
    const root = makeRepo();
    git(root, ["branch", "target"]);
    git(root, ["checkout", "-q", "target"]);
    commit(root, "shared.txt", "shared");
    git(root, ["checkout", "-qb", "feature", "main"]);
    commit(root, "shared.txt", "shared rewritten");
    const targetSha = git(root, ["rev-parse", "target"]).trim();
    const featureSha = git(root, ["rev-parse", "feature"]).trim();
    expect(targetSha).not.toBe(featureSha);

    const { spawn, calls } = jjStub({ [targetSha]: "CHANGE-1", [featureSha]: "CHANGE-1" });
    const report = auditJjHistory({ root, branch: "feature", onto: "target", spawn, ...DEFAULTS });

    const dup = report.findings["duplicate-change-id"] ?? [];
    expect(dup).toHaveLength(1);
    expect(dup[0]!.changeId).toBe("CHANGE-1");
    expect(dup[0]!.sha).toBe(featureSha);
    expect(dup[0]!.twins).toEqual([targetSha]);
    const revset = calls[0]![calls[0]!.indexOf("-r") + 1]!;
    expect(revset).toContain(`commit_id(${featureSha})`);
    expect(revset).toContain(`commit_id(${targetSha})`);
    expect(report.exit).toBe(1);
  });

  test("duplicate/rewrite finding is reported alongside the git patch-id signal", () => {
    const root = makeRepo();
    git(root, ["branch", "target"]);
    git(root, ["checkout", "-q", "target"]);
    commit(root, "shared.txt", "shared change");
    git(root, ["checkout", "-qb", "feature", "main"]);
    // Same blob as target, different subject: git patch-id still matches.
    writeFileSync(join(root, "shared.txt"), "shared change\n");
    git(root, ["add", "shared.txt"]);
    git(root, ["commit", "-qm", "shared change replayed"]);
    const targetSha = git(root, ["rev-parse", "target"]).trim();
    const featureSha = git(root, ["rev-parse", "feature"]).trim();

    const { spawn } = jjStub({ [targetSha]: "CHANGE-9", [featureSha]: "CHANGE-9" });
    const report = auditJjHistory({ root, branch: "feature", onto: "target", spawn, ...DEFAULTS });

    expect(report.findings["duplicate-patch-id"]).toHaveLength(1);
    const dup = report.findings["duplicate-change-id"] ?? [];
    expect(dup).toHaveLength(1);
    expect(dup[0]!.changeId).toBe("CHANGE-9");
    expect(dup[0]!.evidence).toContain("CHANGE-9");
    expect(report.exit).toBe(1);
  });

  test("clean range has no findings and exit 0", () => {
    const root = makeRepo();
    git(root, ["branch", "target"]);
    git(root, ["checkout", "-qb", "feature", "main"]);
    commit(root, "fresh.txt", "fresh work");
    const targetSha = git(root, ["rev-parse", "target"]).trim();
    const featureSha = git(root, ["rev-parse", "feature"]).trim();
    const { spawn } = jjStub({ [targetSha]: "CHANGE-A", [featureSha]: "CHANGE-B" });
    const report = auditJjHistory({ root, branch: "feature", onto: "target", spawn, ...DEFAULTS });
    expect(Object.keys(report.findings)).toHaveLength(0);
    expect(report.exit).toBe(0);
  });
});
