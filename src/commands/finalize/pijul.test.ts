// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import type { PijulResult, PijulSpawn } from "../../vcs/pijul";
import { finalizeWithPijulCommutation } from "./pijul";

const ROOT = "/clone";
type Reply = PijulResult | string;

function stub(replies: Record<string, Reply> = {}) {
  const calls: string[][] = [];
  const cwds: string[] = [];
  const spawn: PijulSpawn = (cmd, cwd) => {
    calls.push([...cmd]);
    cwds.push(cwd);
    const reply = replies[cmd.join(" ")] ?? "";
    return typeof reply === "string" ? { stdout: reply, stderr: "", exitCode: 0 } : reply;
  };
  return { spawn, calls, cwds };
}

const OWN = ["OLDCHANGE0000000000000001", "BASECHANGE00000000000001", "NEWCHANGE0000000000000001"];
const BASE = ["BASECHANGE00000000000001"];
const LOG = (channel: string): string =>
  `pijul log --hash-only --output-format json --channel ${channel}`;

describe("finalizeWithPijulCommutation", () => {
  test("gates first, then applies only new changes onto main by commutation", async () => {
    const { spawn, calls, cwds } = stub({
      [LOG("feature")]: JSON.stringify(OWN),
      [LOG("main")]: JSON.stringify(BASE),
    });
    let gates = 0;
    const summary = await finalizeWithPijulCommutation({
      root: ROOT,
      branch: "feature",
      spawn,
      runGates: () => {
        gates += 1;
      },
    });
    expect(gates).toBe(1);
    expect(summary).toEqual({
      backend: "pijul",
      branch: "feature",
      channel: "main",
      applied: ["NEWCHANGE0000000000000001", "OLDCHANGE0000000000000001"],
    });
    expect(calls).toEqual([
      ["pijul", "log", "--hash-only", "--output-format", "json", "--channel", "feature"],
      ["pijul", "log", "--hash-only", "--output-format", "json", "--channel", "main"],
      ["pijul", "apply", "NEWCHANGE0000000000000001", "--channel", "main"],
      ["pijul", "apply", "OLDCHANGE0000000000000001", "--channel", "main"],
    ]);
    expect(cwds.every((cwd) => cwd === ROOT)).toBe(true);
  });

  test("gate failure performs no pijul mutation", async () => {
    const { spawn, calls } = stub();
    await expect(finalizeWithPijulCommutation({
      root: ROOT,
      branch: "feature",
      spawn,
      runGates: () => {
        throw new Error("gates red");
      },
    })).rejects.toThrow("gates red");
    expect(calls).toEqual([]);
  });
});
