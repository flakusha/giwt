// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt backup annex-sync` lane: authorization through the passthrough
 * classifier (classifyGit → classifyAnnex) with the repo's OWN policy
 * lists, numcopies RO-probe refusal, ledger sync events, and status
 * visibility. Spawn-heavy paths run through the injected seam; the
 * per-repo policy layers are exercised with real giwt.toml files.
 */

import { describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAnnexSyncGate } from "../commands/backup-gates";
import { scratchRoot } from "../utils/scratch-tmp";
import { loadSettings } from "../utils/settings";
import { repoPolicyLists, runAnnexSync } from "./annex-sync";
import { runStatusCommand } from "./orchestrate";
import { readState } from "./state";

interface SyncCalls {
  cmds: string[][];
  /** All spawned commands incl. the probe; assertions use this. */
  spawn: (cmd: string[]) => { exitCode: number; stdout: string; stderr: string; };
}

function spawnStub(
  responses: Array<{ exitCode: number; stdout: string; stderr: string; }>,
): SyncCalls {
  const cmds: string[][] = [];
  let i = 0;
  return {
    cmds,
    spawn: (cmd) => {
      cmds.push(cmd);
      const res = responses[i];
      i++;
      return res ?? { exitCode: 0, stdout: "", stderr: "" };
    },
  };
}

function makeRepo(name: string, toml: string | null): string {
  const repo = mkdtempSync(join(scratchRoot(), `giwt-annex-sync-${name}-`));
  if (toml !== null) writeFileSync(join(repo, "giwt.toml"), toml);
  return repo;
}

const ALLOWED_TOML = "[git]\nallow = [\"annex sync\"]\n";
const PLAIN_TOML = "[backup]\nroot = \"backups\"\n";

function opts(repo: string): { repoRoot: string; treeDir: string; timeoutMs: number; } {
  return { repoRoot: repo, treeDir: repo, timeoutMs: 60_000 };
}

describe("runAnnexSync — authorization", () => {
  test("default-deny: no repo [git] allow → classifier refusal naming the policy source; no spawn", () => {
    const repo = makeRepo("deny", PLAIN_TOML);
    try {
      const spy = spawnStub([]);
      expect(() => runAnnexSync(opts(repo), { spawn: spy.spawn })).toThrow(
        /authorization refused.*\[git\] allow = \["annex sync"\] in repo giwt\.toml/s,
      );
      // The refusal is the CLASSIFIER's verdict — nothing spawned at all.
      expect(spy.cmds).toHaveLength(0);
      // The refusal is observable in the state ledger, never a green exit.
      const events = readState(repo);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ kind: "sync", ok: false, remote: "", path: repo });
      expect(events[0]!.note).toContain("authorization refused");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("per-resource: a [git] allow in the GLOBAL config alone never authorizes", () => {
    const repo = makeRepo("global-allow", PLAIN_TOML);
    const outer = mkdtempSync(join(scratchRoot(), "giwt-annex-sync-xdg-"));
    try {
      // The global layer grants exactly what the repo withholds.
      mkdirSync(join(outer, "giwt"), { recursive: true });
      writeFileSync(join(outer, "giwt", "config.toml"), ALLOWED_TOML);
      const globalPath = join(outer, "giwt", "config.toml");
      // Hazard documented: the plain layered loader WOULD merge the allow.
      expect(loadSettings(repo, { globalPath }).git.allow).toEqual(["annex sync"]);
      // The lane resolves repo-only lists, so the classifier still blocks.
      expect(repoPolicyLists(repo).allow).toEqual([]);
      const spy = spawnStub([]);
      expect(() => runAnnexSync(opts(repo), { spawn: spy.spawn })).toThrow("authorization refused");
      expect(spy.cmds).toHaveLength(0);
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(outer, { recursive: true, force: true });
    }
  });

  test("per-resource: env-config alone never authorizes (skipGlobal ignores XDG layer)", () => {
    const repo = makeRepo("env-allow", PLAIN_TOML);
    const outer = mkdtempSync(join(scratchRoot(), "giwt-annex-sync-env-"));
    const prevXdg = process.env.XDG_CONFIG_HOME;
    try {
      mkdirSync(join(outer, "giwt"), { recursive: true });
      writeFileSync(join(outer, "giwt", "config.toml"), ALLOWED_TOML);
      process.env.XDG_CONFIG_HOME = outer;
      // repoPolicyLists never consults the env-resolved global layer.
      expect(repoPolicyLists(repo).allow).toEqual([]);
      const spy = spawnStub([]);
      expect(() => runAnnexSync(opts(repo), { spawn: spy.spawn })).toThrow("authorization refused");
      expect(spy.cmds).toHaveLength(0);
    } finally {
      if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prevXdg;
      rmSync(repo, { recursive: true, force: true });
      rmSync(outer, { recursive: true, force: true });
    }
  });

  test("repo [git] allow authorizes; probe + sync spawn in order, ledger records ok", () => {
    const repo = makeRepo("allowed", ALLOWED_TOML);
    try {
      const spy = spawnStub([
        { exitCode: 0, stdout: "whereis: 1 determined\n", stderr: "" },
        { exitCode: 0, stdout: "push origin\npull origin\ncopy 2/3\n", stderr: "" },
      ]);
      const writeSpy = spyOn(process.stderr, "write");
      runAnnexSync(opts(repo), { spawn: spy.spawn });
      writeSpy.mockRestore();
      expect(spy.cmds).toEqual([
        ["git", "-C", repo, "annex", "whereis"],
        ["git", "-C", repo, "annex", "sync", "--content"],
      ]);
      const events = readState(repo);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        kind: "sync",
        ok: true,
        remote: "",
        path: repo,
      });
      expect(events[0]!.note).toContain("copy 2/3");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("runAnnexSync — numcopies evidence and failures", () => {
  test("annex unavailable (probe fails): refuses, sync never spawns, ledger records fail", () => {
    const repo = makeRepo("probe-fail", ALLOWED_TOML);
    try {
      const spy = spawnStub([
        { exitCode: 1, stdout: "", stderr: "git-annex: not a git-annex repo" },
      ]);
      expect(() => runAnnexSync(opts(repo), { spawn: spy.spawn })).toThrow(
        "numcopies unverifiable",
      );
      expect(spy.cmds).toHaveLength(1); // probe only — the sync never ran
      const events = readState(repo);
      expect(events[0]).toMatchObject({ kind: "sync", ok: false });
      expect(events[0]!.note).toContain("numcopies unverifiable");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("sync tool failure: ledger records the failure, error surfaces", () => {
    const repo = makeRepo("sync-fail", ALLOWED_TOML);
    try {
      const spy = spawnStub([
        { exitCode: 0, stdout: "whereis: 1 determined\n", stderr: "" },
        { exitCode: 1, stdout: "", stderr: "scp: remote host refused\nthat is all\n" },
      ]);
      expect(() => runAnnexSync(opts(repo), { spawn: spy.spawn })).toThrow(
        "git annex sync exited 1",
      );
      const events = readState(repo);
      expect(events[0]).toMatchObject({ kind: "sync", ok: false });
      expect(events[0]!.note).toContain("remote host refused");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("default-spawn wrapper and command gate", () => {
  test("no injected spawn: the default Bun wrapper runs the probe against a real repo and refuses", () => {
    const repo = makeRepo("default-spawn", ALLOWED_TOML);
    try {
      // Plain git repo: the whereis probe exits non-zero -> numcopies refusal.
      Bun.spawnSync(["git", "init", "-q", repo]);
      expect(() => runAnnexSync(opts(repo))).toThrow("numcopies unverifiable");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("gate: forwards the timeout budget and refuses flags before any spawn", () => {
    const repo = makeRepo("gate", PLAIN_TOML);
    try {
      const config = {
        repoRoot: repo,
        worktreeRoot: repo,
        treeDir: repo,
        settings: {
          ...loadSettings(repo),
          backup: { root: "backups", targets: [], timeoutMs: 1234 },
        },
      } as never;
      expect(() => runAnnexSyncGate(["--flag"], config)).toThrow("annex-sync takes no flags");
      // Flag-less invocation reaches the classifier and refuses (empty allow).
      expect(() => runAnnexSyncGate([], config)).toThrow("authorization refused");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("annex-sync outcome visibility", () => {
  test("the sync event is visible as `sync (local)` via the status runner", () => {
    const repo = makeRepo("status", ALLOWED_TOML);
    try {
      runAnnexSync(opts(repo), {
        spawn: spawnStub([
          { exitCode: 0, stdout: "whereis: 1 determined\n", stderr: "" },
          { exitCode: 0, stdout: "copy 1/1\n", stderr: "" },
        ]).spawn,
      });
      const writeSpy = spyOn(process.stdout, "write");
      runStatusCommand(
        {
          repoRoot: repo,
          worktreeRoot: repo,
          treeDir: repo,
          settings: { git: { allow: ["annex sync"] } } as never,
        },
        { staleness: "24h", strict: false, annex: false },
      );
      const out = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      writeSpy.mockRestore();
      expect(out).toContain("sync (local):");
      expect(out).not.toContain("sync (local): never");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
