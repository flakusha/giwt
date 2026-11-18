// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import type { JjResult, JjSpawn } from "../../vcs/jj";
import { finalizeWithJjOpLog } from "./jj";

const ROOT = "/repo";
type Reply = JjResult | string;

function stub(replies: Record<string, Reply> = {}) {
  const calls: string[][] = [];
  const cwds: string[] = [];
  const spawn: JjSpawn = (cmd, cwd) => {
    calls.push([...cmd]);
    cwds.push(cwd);
    const reply = replies[cmd.join(" ")] ?? "";
    return typeof reply === "string" ? { stdout: reply, stderr: "", exitCode: 0 } : reply;
  };
  return { spawn, calls, cwds };
}

const OP_LOG = ["jj", "op", "log", "-n", "1", "-T", "id"];
const OP_REVERT = ["jj", "op", "revert", "--op", "op-123"];
const BOOKMARK_SET = ["jj", "bookmark", "set", "feature/x", "-r", "@"];

describe("finalizeWithJjOpLog", () => {
  test("captures the op, runs the injected gates, sets the bookmark, returns a summary", async () => {
    const { spawn, calls, cwds } = stub({ "jj op log -n 1 -T id": "op-123\n" });
    let gates = 0;
    const summary = await finalizeWithJjOpLog({
      root: ROOT,
      branch: "feature/x",
      ontop: "main",
      spawn,
      runGates: () => {
        gates += 1;
      },
    });
    expect(gates).toBe(1);
    expect(summary).toEqual({
      backend: "jj",
      branch: "feature/x",
      opId: "op-123",
      ontop: "main",
      bookmark: "feature/x",
      reverted: false,
    });
    expect(calls).toEqual([OP_LOG, BOOKMARK_SET]);
    expect(cwds.every((cwd) => cwd === ROOT)).toBe(true);
  });

  test("gate failure reverts the captured op and rethrows without moving the bookmark", async () => {
    const { spawn, calls } = stub({ "jj op log -n 1 -T id": "op-123\n" });
    await expect(finalizeWithJjOpLog({
      root: ROOT,
      branch: "feature/x",
      spawn,
      runGates: () => {
        throw new Error("gates red");
      },
    })).rejects.toThrow("gates red");
    expect(calls).toEqual([OP_LOG, OP_REVERT]);
  });

  test("missing op id refuses before any mutation", async () => {
    const { spawn, calls } = stub();
    await expect(finalizeWithJjOpLog({
      root: ROOT,
      branch: "feature/x",
      spawn,
      runGates: () => {},
    })).rejects.toThrow(/no operation id/);
    expect(calls).toEqual([OP_LOG]);
  });
});
