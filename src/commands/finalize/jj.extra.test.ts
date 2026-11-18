// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Extra coverage for the jj op-log finalize path: the failure branches of
 * the internal `run` helper and of the rollback path (gates red AND the
 * revert itself failing). The jj CLI is never spawned — an injected spawn
 * seam answers every invocation.
 */

import { describe, expect, test } from "bun:test";
import type { JjResult, JjSpawn } from "../../vcs/jj";
import { finalizeWithJjOpLog } from "./jj";

const ROOT = "/repo";
type Reply = JjResult | string;

function stub(replies: Record<string, Reply> = {}) {
  const calls: string[][] = [];
  const spawn: JjSpawn = (cmd) => {
    calls.push([...cmd]);
    const reply = replies[cmd.join(" ")] ?? "";
    return typeof reply === "string" ? { stdout: reply, stderr: "", exitCode: 0 } : reply;
  };
  return { spawn, calls };
}

describe("finalizeWithJjOpLog failure branches", () => {
  test("a failing op-log capture refuses before the gates run", async () => {
    const { spawn, calls } = stub({
      "jj op log -n 1 -T id": { stdout: "", stderr: "no jj repository", exitCode: 255 },
    });
    let gates = 0;
    await expect(finalizeWithJjOpLog({
      root: ROOT,
      branch: "feature/x",
      spawn,
      runGates: () => {
        gates += 1;
      },
    })).rejects.toThrow("jj op log -n 1 -T id failed (exit 255): no jj repository");
    expect(gates).toBe(0);
    expect(calls).toEqual([["jj", "op", "log", "-n", "1", "-T", "id"]]);
  });

  test("a failing bookmark move surfaces the jj exit code", async () => {
    const { spawn, calls } = stub({
      "jj op log -n 1 -T id": "op-123\n",
      "jj bookmark set feature/x -r @": { stdout: "", stderr: "bookmark exists", exitCode: 3 },
    });
    await expect(finalizeWithJjOpLog({
      root: ROOT,
      branch: "feature/x",
      spawn,
      runGates: () => {},
    })).rejects.toThrow("jj bookmark set feature/x -r @ failed (exit 3): bookmark exists");
    expect(calls).toEqual([
      ["jj", "op", "log", "-n", "1", "-T", "id"],
      ["jj", "bookmark", "set", "feature/x", "-r", "@"],
    ]);
  });

  test("a failing revert alongside red gates reports both failures", async () => {
    const { spawn, calls } = stub({
      "jj op log -n 1 -T id": "op-123\n",
      "jj op revert --op op-123": { stdout: "", stderr: "op not found", exitCode: 5 },
    });
    await expect(finalizeWithJjOpLog({
      root: ROOT,
      branch: "feature/x",
      spawn,
      runGates: () => {
        throw new Error("gates red");
      },
    })).rejects.toThrow(
      "gates failed and jj op revert --op op-123 also failed (exit 5): op not found; "
        + "original failure: Error: gates red",
    );
    expect(calls).toEqual([
      ["jj", "op", "log", "-n", "1", "-T", "id"],
      ["jj", "op", "revert", "--op", "op-123"],
    ]);
  });

  test("a successful revert after red gates still rethrows the gate failure", async () => {
    const { spawn, calls } = stub({
      "jj op log -n 1 -T id": "op-123\n",
      "jj op revert --op op-123": "reverted\n",
    });
    await expect(finalizeWithJjOpLog({
      root: ROOT,
      branch: "feature/x",
      spawn,
      runGates: () => {
        throw new Error("gates red");
      },
    })).rejects.toThrow("gates red");
    expect(calls).toEqual([
      ["jj", "op", "log", "-n", "1", "-T", "id"],
      ["jj", "op", "revert", "--op", "op-123"],
    ]);
  });

  test("the default ontop is an empty string and the bookmark follows the branch", async () => {
    const { spawn } = stub({ "jj op log -n 1 -T id": "op-123\n" });
    const summary = await finalizeWithJjOpLog({
      root: ROOT,
      branch: "feature/x",
      spawn,
      runGates: () => {},
    });
    expect(summary.ontop).toBe("");
    expect(summary.bookmark).toBe("feature/x");
    expect(summary.reverted).toBe(false);
  });
});
