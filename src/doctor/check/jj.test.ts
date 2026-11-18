// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/** Version floor / colocation / binary-presence probes for VCS doctor checks. */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { scratchRoot } from "../../utils/scratch-tmp";
import { PIJUL_PINNED_VERSION } from "../../vcs/pijul.ts";
import { runDoctorChecks } from "./entry.ts";
import { JJ_VERSION_FLOOR, parseJjVersion, runVcsCheck } from "./jj.ts";
import type { SpawnResult } from "./spawn.ts";

type Reply = (cmd: string[]) => SpawnResult;
const ok = (stdout: string): SpawnResult => ({ exitCode: 0, stdout, stderr: "" });

const jjOk: Reply = (cmd) =>
  ok(cmd[1] === "--version" ? "jj 0.46.0\n" : "The repo is currently colocated with Git.\n");
const pijulOk: Reply = () => ok(`pijul ${PIJUL_PINNED_VERSION}\n`);

function jjOpts(spawn: Reply, backend: "git" | "jj" | "pijul" = "jj") {
  return { root: process.cwd(), vcsBackend: backend, spawn };
}

describe("VCS doctor checks", () => {
  test("jj version parsing accepts 0.46 and rejects junk", () => {
    expect(parseJjVersion("jj 0.46.0\n")).toEqual({
      major: 0,
      minor: 46,
      patch: 0,
      beta: null,
    });
    expect(parseJjVersion("jj 0.46\n")?.patch).toBe(0);
    expect(parseJjVersion("nope")).toBeNull();
  });

  test("both checks skip when the configured backend is git", async () => {
    for (const id of ["jj", "pijul"] as const) {
      const result = await runVcsCheck(id, jjOpts(jjOk, "git"));
      expect(result.ok).toBe(true);
      expect(result.skipped).toContain("git");
      expect(result.findings).toEqual([]);
    }
  });

  test("jj passes at the version floor in a colocated repo", async () => {
    const result = await runVcsCheck("jj", jjOpts(jjOk));
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.notes?.join(" ")).toContain(JJ_VERSION_FLOOR);
  });

  test("jj fails below the floor and when not colocated", async () => {
    const old = await runVcsCheck("jj", jjOpts(() => ok("jj 0.45.0\n")));
    expect(old.ok).toBe(false);
    expect(old.findings.map((f) => f.rule)).toContain("jj-version");
    expect(old.findings[0]?.message).toContain(">= 0.46.0");
    const detached = await runVcsCheck(
      "jj",
      jjOpts((cmd) => cmd[1] === "--version" ? ok("jj 0.46.0\n") : ok("not colocated\n")),
    );
    expect(detached.findings.map((f) => f.rule)).toContain("jj-colocation");
  });

  test("jj reports a missing binary instead of crashing", async () => {
    const result = await runVcsCheck(
      "jj",
      jjOpts(() => {
        throw new Error("ENOENT");
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.findings[0]?.rule).toBe("jj-binary");
  });

  test("jj flags workspaces whose on-disk checkout is gone (read-only)", async () => {
    const root = mkdtempSync(join(scratchRoot(), "giwt-jj-doctor-"));
    const live = join(root, "live");
    const gone = join(root, "gone");
    mkdirSync(live);
    try {
      const spawn: Reply = (cmd) =>
        cmd[1] === "--version"
          ? ok("jj 0.46.0\n")
          : cmd[1] === "workspace"
          ? ok(`default|${root}\nlive|${live}\ngone|${gone}\n`)
          : ok("The repo is currently colocated with Git.\n");
      const result = await runVcsCheck("jj", { ...jjOpts(spawn), root });
      const stale = result.findings.filter((f) => f.rule === "jj-stale-workspace");
      expect(stale).toHaveLength(1);
      expect(stale[0]?.message).toContain("gone");
      expect(stale[0]?.message).not.toContain("live");
      expect(existsSync(gone)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("pijul pins the exact beta", async () => {
    const good = await runVcsCheck("pijul", jjOpts(pijulOk, "pijul"));
    expect(good.ok).toBe(true);
    const bad = await runVcsCheck("pijul", jjOpts(() => ok("pijul 1.0.0-beta.26\n"), "pijul"));
    expect(bad.ok).toBe(false);
    expect(bad.findings[0]?.message).toContain("need exactly");
  });

  test("entry dispatch runs the configured backend and skips the other", async () => {
    const report = await runDoctorChecks(process.cwd(), {
      checks: ["jj", "pijul"],
      vcsBackend: "jj",
      spawn: (cmd) => (cmd[0] === "jj" ? jjOk(cmd) : pijulOk(cmd)),
    });
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["jj"]?.ok).toBe(true);
    expect(byId["pijul"]?.skipped).toContain("jj");
  });
});
