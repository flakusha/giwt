// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Extra coverage for the pijul commutation finalize path: the failure
 * branch of the internal `run` helper (a non-zero pijul exit must abort
 * before any apply) and the already-present-in-base skip. The pijul CLI is
 * never spawned — an injected spawn seam answers every invocation.
 */

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

const LOG = (channel: string): string =>
  `pijul log --hash-only --output-format json --channel ${channel}`;

const OWN = "OWNCHANGE00000000000001";
const BASE = "BASECHANGE00000000000001";

describe("finalizeWithPijulCommutation failure branches", () => {
  test("a failing channel log aborts before any apply", async () => {
    const { spawn, calls } = stub({
      [LOG("feature")]: { stdout: "", stderr: "no such channel", exitCode: 2 },
    });
    await expect(finalizeWithPijulCommutation({
      root: ROOT,
      branch: "feature",
      spawn,
      runGates: () => {},
    })).rejects.toThrow(
      "pijul log --hash-only --output-format json --channel feature failed (exit 2): no such channel",
    );
    expect(calls).toEqual([
      ["pijul", "log", "--hash-only", "--output-format", "json", "--channel", "feature"],
    ]);
  });

  test("a failing apply aborts and reports the pijul exit code", async () => {
    const { spawn, calls } = stub({
      [LOG("feature")]: JSON.stringify([OWN]),
      [LOG("main")]: JSON.stringify([]),
      "pijul apply OWNCHANGE00000000000001 --channel main": {
        stdout: "",
        stderr: "conflicting change",
        exitCode: 4,
      },
    });
    await expect(finalizeWithPijulCommutation({
      root: ROOT,
      branch: "feature",
      spawn,
      runGates: () => {},
    })).rejects.toThrow(
      "pijul apply OWNCHANGE00000000000001 --channel main failed (exit 4): conflicting change",
    );
    expect(calls).toEqual([
      ["pijul", "log", "--hash-only", "--output-format", "json", "--channel", "feature"],
      ["pijul", "log", "--hash-only", "--output-format", "json", "--channel", "main"],
      ["pijul", "apply", OWN, "--channel", "main"],
    ]);
  });

  test("changes already present on the base channel are not applied again", async () => {
    const { spawn, calls, cwds } = stub({
      [LOG("feature")]: JSON.stringify([OWN, BASE]),
      [LOG("main")]: JSON.stringify([BASE]),
    });
    const summary = await finalizeWithPijulCommutation({
      root: ROOT,
      branch: "feature",
      spawn,
      runGates: () => {},
    });
    expect(summary.applied).toEqual([OWN]);
    expect(summary.channel).toBe("main");
    expect(summary.backend).toBe("pijul");
    expect(calls.filter((c) => c[1] === "apply")).toEqual([[
      "pijul",
      "apply",
      OWN,
      "--channel",
      "main",
    ]]);
    expect(cwds.every((cwd) => cwd === ROOT)).toBe(true);
  });

  test("an empty agent channel applies nothing", async () => {
    const { spawn, calls } = stub({
      [LOG("feature")]: JSON.stringify([]),
      [LOG("main")]: JSON.stringify([]),
    });
    const summary = await finalizeWithPijulCommutation({
      root: ROOT,
      branch: "feature",
      spawn,
      runGates: () => {},
    });
    expect(summary.applied).toEqual([]);
    expect(calls.filter((c) => c[1] === "apply")).toEqual([]);
  });
});
