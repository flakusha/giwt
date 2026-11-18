// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  changeHashes,
  defaultPijulSpawn,
  makePijulBackend,
  PIJUL_PINNED_VERSION,
  pijulBackend,
  type PijulResult,
  type PijulSpawn,
} from "./pijul";

const ROOT = "/repo";
type Reply = PijulResult | string;

function stub(replies: Record<string, Reply> = {}, onClone?: (path: string) => void) {
  const calls: string[][] = [];
  const spawn: PijulSpawn = (cmd, _cwd) => {
    calls.push(cmd);
    if (cmd[1] === "clone") {
      const path = cmd.at(-1)!;
      onClone?.(path);
      return { stdout: `Repository created at ${path}\n`, stderr: "", exitCode: 0 };
    }
    const reply = replies[cmd.join(" ")] ?? "";
    return typeof reply === "string" ? { stdout: reply, stderr: "", exitCode: 0 } : reply;
  };
  return { spawn, calls };
}

const GUARD: Record<string, Reply> = { "pijul --version": `pijul ${PIJUL_PINNED_VERSION}\n` };
const g = (replies: Record<string, Reply>): Record<string, Reply> => ({ ...GUARD, ...replies });

function expectOnlyPijul(calls: string[][]): void {
  for (const cmd of calls) expect(cmd[0]).toBe("pijul");
}

describe("pijul backend (stubbed argv)", () => {
  test("exports a native backend and never falls back to git", async () => {
    expect(pijulBackend.name).toBe("pijul");
    const { spawn, calls } = stub({
      "pijul --version": { stdout: "", stderr: "missing", exitCode: 127 },
    });
    await expect(makePijulBackend(spawn).listBranches(ROOT)).rejects.toThrow(/missing/);
    expectOnlyPijul(calls);
  });

  test("pins the exact beta and names the identity remedy", async () => {
    const { spawn, calls } = stub({ "pijul --version": "pijul 1.0.0-beta.26\n" });
    await expect(makePijulBackend(spawn).listBranches(ROOT)).rejects.toThrow(
      /need exactly 1\.0\.0-beta\.24/,
    );
    const bad = stub({ "pijul --version": "pijul 1.0.0-beta.26\n" });
    await expect(makePijulBackend(bad.spawn).listBranches(ROOT)).rejects.toThrow(/ssh-add/);
    expectOnlyPijul(calls);
  });

  test("lists channels and recomputes ahead/behind from change-hash sets", async () => {
    const own = JSON.stringify(["AAAAAAAAAAAAAAAAAAAA", "BBBBBBBBBBBBBBBBBBBB"]);
    const base = JSON.stringify(["AAAAAAAAAAAAAAAAAAAA", "CCCCCCCCCCCCCCCCCCCC"]);
    const { spawn, calls } = stub(g({
      "pijul channel": "* main\n  feature\n",
      "pijul log --hash-only --output-format json --channel feature": own,
      "pijul log --hash-only --output-format json --channel main": base,
      "pijul status --output-format json":
        "{ \"channel\": \"main\", \"changes\": [], \"untracked\": [\".ignore\"] }",
      "pijul diff --channel feature --output-format json":
        "{ \"note.txt\": [], \"dir/a.txt\": [] }",
    }));
    const backend = makePijulBackend(spawn);
    expect(await backend.listBranches(ROOT)).toEqual([
      { name: "main", current: true },
      { name: "feature", current: false },
    ]);
    expect(await backend.status(ROOT, "feature")).toEqual({
      branch: "feature",
      ahead: 1,
      behind: 1,
      clean: true,
    });
    expect(await backend.diff(ROOT, "feature")).toEqual(["note.txt", "dir/a.txt"]);
    expectOnlyPijul(calls);
  });

  test("treats unrecorded tracked changes as dirty", async () => {
    const { spawn } = stub(g({
      "pijul log --hash-only --output-format json --channel main": "[]",
      "pijul status --output-format json": "{ \"changes\": [{ \"operation\": \"file add\" }] }",
    }));
    expect((await makePijulBackend(spawn).status(ROOT, "main")).clean).toBe(false);
  });

  test("commit maps to record and returns the intrinsic change hash", async () => {
    const { spawn, calls } = stub(g({
      "pijul record -a -m pijul smoke": "Recorded a new change\n",
      "pijul log --hash-only --output-format json --limit 1": "[\"ABCDEF1234567890ABCDEF\"]",
    }));
    const result = await makePijulBackend(spawn).commit({ cwd: ROOT, message: "pijul smoke" });
    expect(result).toEqual({ sha: "ABCDEF1234567890ABCDEF" });
    expect(calls.slice(1)).toEqual([
      ["pijul", "record", "-a", "-m", "pijul smoke"],
      ["pijul", "log", "--hash-only", "--output-format", "json", "--limit", "1"],
    ]);
    expectOnlyPijul(calls);
  });

  test("workspaces are clone dirs with no channel switching", async () => {
    const root = mkdtempSync(join(tmpdir(), "giwt-pijul-backend-"));
    try {
      const { spawn, calls } = stub(
        g({}),
        (path) => mkdirSync(join(path, ".pijul"), { recursive: true }),
      );
      const backend = makePijulBackend(spawn);
      const clone = join(root, "tree", "agent-1");
      mkdirSync(join(root, "tree"), { recursive: true });
      await backend.createWorkspace({ root, path: clone, branch: "agent-1", base: "main" });
      expect(existsSync(join(clone, ".pijul"))).toBe(true);
      expect(await backend.listWorkspaces(root)).toEqual([{ path: clone, branch: "agent-1" }]);
      expect(calls.some((cmd) => cmd.includes("switch"))).toBe(false);
      await backend.removeWorkspace({ root, path: clone });
      expect(existsSync(clone)).toBe(false);
      expect(await backend.listWorkspaces(root)).toEqual([]);
      expectOnlyPijul(calls);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("change-hash parsing tolerates json, objects and plain output", () => {
    expect(changeHashes("")).toEqual(new Set());
    expect(changeHashes("No matching logs found")).toEqual(new Set());
    expect(changeHashes("[{\"hash\":\"AAAAAAAAAAAAAAAAAAAA\"}]")).toEqual(
      new Set(["AAAAAAAAAAAAAAAAAAAA"]),
    );
    expect(changeHashes("BBBBBBBBBBBBBBBBBBBB CCCCCCCCCCCCCCCCCCCC")).toEqual(
      new Set(["BBBBBBBBBBBBBBBBBBBB", "CCCCCCCCCCCCCCCCCCCC"]),
    );
  });

  test("malformed backend output fails closed", async () => {
    const badVersion = stub({ "pijul --version": "no version here\n" });
    await expect(makePijulBackend(badVersion.spawn).listBranches(ROOT)).rejects.toThrow(
      /not supported/,
    );
    expect(changeHashes("[{\"nope\":\"AAAAAAAAAAAAAAAAAAAA\"}]")).toEqual(new Set());

    const status = stub(g({
      "pijul log --hash-only --output-format json --channel main": "[]",
      "pijul status --output-format json": "not json",
    }));
    expect((await makePijulBackend(status.spawn).status(ROOT, "main")).clean).toBe(false);

    for (const raw of ["not json", "42"]) {
      const diff = stub(g({ "pijul diff --channel main --output-format json": raw }));
      expect(await makePijulBackend(diff.spawn).diff(ROOT, "main")).toEqual([]);
    }

    const noHash = stub(g({
      "pijul record -a -m pijul smoke": "recorded\n",
      "pijul log --hash-only --output-format json --limit 1": "[]",
    }));
    await expect(makePijulBackend(noHash.spawn).commit({ cwd: ROOT, message: "pijul smoke" }))
      .rejects.toThrow(/no change hash/);

    const root = mkdtempSync(join(tmpdir(), "giwt-pijul-remove-"));
    try {
      await expect(
        makePijulBackend(stub().spawn).removeWorkspace({ root, path: join(root, "missing") }),
      )
        .rejects.toThrow(/no giwt-managed pijul clone/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("default spawn delegates to Bun.spawnSync and reports spawn failures", () => {
    const good = spyOn(Bun, "spawnSync").mockImplementation(
      ((_cmd: string[], _opts: unknown) => ({
        stdout: Buffer.from(`pijul ${PIJUL_PINNED_VERSION}\n`),
        stderr: Buffer.from(""),
        exitCode: 0,
      })) as never,
    );
    try {
      expect(defaultPijulSpawn(["pijul", "--version"], ROOT)).toEqual({
        stdout: `pijul ${PIJUL_PINNED_VERSION}\n`,
        stderr: "",
        exitCode: 0,
      });
    } finally {
      good.mockRestore();
    }

    const bad = spyOn(Bun, "spawnSync").mockImplementation(
      (() => {
        throw new Error("ENOENT");
      }) as never,
    );
    try {
      expect(defaultPijulSpawn(["pijul", "--version"], ROOT).exitCode).toBe(127);
    } finally {
      bad.mockRestore();
    }
  });
});
