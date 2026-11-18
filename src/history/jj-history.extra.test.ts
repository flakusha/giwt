// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Extra coverage for the jj change-id seam: the default spawn wrapper
 * (success, failure, and the throw path) and `tryJjChangeIds`, which warns
 * and degrades to `undefined` when jj is unavailable. Bun.spawnSync is
 * replaced by a recorder — no jj binary is ever spawned — and restored
 * after every test.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { defaultJjHistorySpawn, jjChangeIds, tryJjChangeIds } from "./jj-history";

const SHA1 = "a".repeat(40);
const SHA2 = "b".repeat(40);

const realSpawnSync = Bun.spawnSync;
let errChunks: string[] = [];
let errSpy: { mockRestore: () => void; } | null = null;

/** Replace Bun.spawnSync with a recorder returning canned output. */
function stubSpawn(result: { stdout?: string; stderr?: string; exitCode?: number; }): string[][] {
  const calls: string[][] = [];
  Bun.spawnSync = ((cmd: string[]) => {
    calls.push([...cmd]);
    return {
      stdout: Buffer.from(result.stdout ?? ""),
      stderr: Buffer.from(result.stderr ?? ""),
      exitCode: result.exitCode ?? 0,
      success: (result.exitCode ?? 0) === 0,
      signal: null,
    };
  }) as unknown as typeof Bun.spawnSync;
  return calls;
}

/** Replace Bun.spawnSync with a thrower (jj missing from PATH). */
function stubSpawnThrows(err: unknown): void {
  Bun.spawnSync = (() => {
    throw err;
  }) as unknown as typeof Bun.spawnSync;
}

function captureStderr(): void {
  errChunks = [];
  errSpy = spyOn(process.stderr, "write").mockImplementation(
    ((chunk: unknown) => {
      errChunks.push(String(chunk));
      return true;
    }) as never,
  );
}

afterEach(() => {
  Bun.spawnSync = realSpawnSync;
  errSpy?.mockRestore();
  errSpy = null;
  errChunks = [];
});

describe("defaultJjHistorySpawn", () => {
  test("returns stdout, stderr and the exit code of the jj invocation", () => {
    const calls = stubSpawn({ stdout: `${SHA1}\x1fchange-one\n`, stderr: "", exitCode: 0 });
    const result = defaultJjHistorySpawn(["jj", "log"], "/repo");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${SHA1}\x1fchange-one\n`);
    expect(result.stderr).toBe("");
    expect(calls).toEqual([["jj", "log"]]);
  });

  test("a non-zero jj exit keeps stderr for the caller to report", () => {
    stubSpawn({ stdout: "", stderr: "no such revset", exitCode: 1 });
    const result = defaultJjHistorySpawn(["jj", "log"], "/repo");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("no such revset");
  });

  test("a missing jj binary degrades to exit 127 with the error message", () => {
    stubSpawnThrows(new Error("Executable not found in $PATH: jj"));
    const result = defaultJjHistorySpawn(["jj", "log"], "/repo");
    expect(result.exitCode).toBe(127);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Executable not found");
  });

  test("a non-Error throw is stringified", () => {
    stubSpawnThrows("boom");
    const result = defaultJjHistorySpawn(["jj", "log"], "/repo");
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toBe("boom");
  });
});

describe("tryJjChangeIds", () => {
  test("returns the change-id map when jj succeeds", () => {
    stubSpawn({ stdout: `${SHA1}\x1fchange-one\n` });
    const map = tryJjChangeIds({ root: "/repo" });
    expect(map?.get(SHA1)).toBe("change-one");
  });

  test("warns and returns undefined when the jj log fails", () => {
    stubSpawn({ stdout: "", stderr: "no such revset", exitCode: 1 });
    captureStderr();
    const map = tryJjChangeIds({ root: "/repo" });
    expect(map).toBeUndefined();
    expect(errChunks.join("")).toContain("jj change-id lookup failed");
    expect(errChunks.join("")).toContain("no such revset");
  });

  test("warns and returns undefined when jj is not installed", () => {
    stubSpawnThrows(new Error("Executable not found in $PATH: jj"));
    captureStderr();
    const map = tryJjChangeIds({ root: "/repo" });
    expect(map).toBeUndefined();
    expect(errChunks.join("")).toContain("jj change-id lookup failed");
  });
});

describe("jjChangeIds revset selection", () => {
  test("an empty sha list still audits all()", () => {
    const calls = stubSpawn({ stdout: "" });
    jjChangeIds({ root: "/repo", shas: [] });
    expect(calls[0]![3]).toBe("all()");
  });

  test("requested shas are unioned into the revset", () => {
    const calls = stubSpawn({ stdout: `${SHA1}\x1fchange-one\n${SHA2}\x1fchange-two\n` });
    const map = jjChangeIds({ root: "/repo", shas: [SHA1, SHA2] });
    expect(calls[0]![3]).toBe(`all() | commit_id(${SHA1}) | commit_id(${SHA2})`);
    expect(map.get(SHA2)).toBe("change-two");
  });
});
