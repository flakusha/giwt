// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import { type PijulResult, type PijulSpawn } from "../vcs/pijul";
import { auditPijulHistory } from "./pijul-audit";

const ROOT = "/repo";
type Reply = PijulResult | string;

function stub(replies: Record<string, Reply> = {}) {
  const calls: string[][] = [];
  const spawn: PijulSpawn = (cmd, cwd) => {
    calls.push(cmd);
    if (cwd !== ROOT) throw new Error(`unexpected cwd ${cwd}`);
    const reply = replies[cmd.join(" ")] ?? "[]";
    return typeof reply === "string" ? { stdout: reply, stderr: "", exitCode: 0 } : reply;
  };
  return { spawn, calls };
}

const logCmd = (channel: string) =>
  ["pijul", "log", "--hash-only", "--output-format", "json", "--channel", channel].join(" ");
const logArgv = (
  channel: string,
) => ["pijul", "log", "--hash-only", "--output-format", "json", "--channel", channel];

const A = "AAAAAAAAAAAAAAAAAAAA";
const B = "BBBBBBBBBBBBBBBBBBBB";
const C = "CCCCCCCCCCCCCCCCCCCC";

const audit = (spawn: PijulSpawn) =>
  auditPijulHistory({ root: ROOT, branch: "feature", target: "main", spawn });

describe("pijul history audit (stubbed argv)", () => {
  test("reports a change hash shared by branch and target", () => {
    const { spawn, calls } = stub({
      [logCmd("feature")]: JSON.stringify([A, B]),
      [logCmd("main")]: JSON.stringify([B, C]),
    });
    const report = audit(spawn);
    expect(report.branch).toBe("feature");
    expect(report.target).toBe("main");
    expect(report.findings).toEqual([{
      reason: "duplicate-change-hash",
      sha: B,
      subject: B,
      patchId: null,
      twins: [B],
      evidence: expect.stringContaining(B),
    }]);
    expect(calls).toEqual([logArgv("feature"), logArgv("main")]);
    for (const reason of ["empty-commit", "merge-in-range", "duplicate-rename-insensitive"]) {
      expect(report.inapplicable.some((s) => s.startsWith(`${reason}:`))).toBe(true);
    }
  });

  test("disjoint histories are clean", () => {
    const { spawn } = stub({
      [logCmd("feature")]: JSON.stringify([A]),
      [logCmd("main")]: JSON.stringify([C]),
    });
    expect(audit(spawn).findings).toEqual([]);
  });

  test("non-zero pijul exit throws", () => {
    const { spawn } = stub({
      [logCmd("feature")]: { stdout: "", stderr: "channel missing", exitCode: 3 },
    });
    expect(() => audit(spawn)).toThrow(/channel missing/);
  });

  test("unparseable pijul output throws", () => {
    const { spawn } = stub({ [logCmd("feature")]: "not json" });
    expect(() => audit(spawn)).toThrow(/unparseable/);
  });
});
