// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import { classifyJjInvocation } from "../jj/policy";
import type { WorktreeConfig } from "../utils/config";
import { DEFAULT_SETTINGS } from "../utils/settings";
import type { JjResult, JjSpawn } from "../vcs/jj";
import { configureJjSigning, jjSigningEntries, setJjSigningIdentity } from "./jj-signing";

const IDENTITY = { keyId: "ABC123", name: "Agent Name", email: "agent@example.com" };

function recorder(failAt?: string): { spawn: JjSpawn; calls: string[][]; } {
  const calls: string[][] = [];
  const spawn: JjSpawn = (cmd) => {
    calls.push(cmd);
    const failed = failAt !== undefined && cmd.includes(failAt);
    const result: JjResult = {
      stdout: "",
      stderr: failed ? "refused" : "",
      exitCode: failed ? 3 : 0,
    };
    return result;
  };
  return { spawn, calls };
}

describe("jj signing identity mapping", () => {
  test("maps .credentials.env identity to jj [signing] and user keys", () => {
    expect(jjSigningEntries(IDENTITY)).toEqual([
      ["signing.behavior", "\"own\""],
      ["signing.backend", "\"gpg\""],
      ["signing.key", "\"ABC123\""],
      ["user.name", "\"Agent Name\""],
      ["user.email", "\"agent@example.com\""],
    ]);
    expect(jjSigningEntries({ name: "a\"b" })).toEqual([["user.name", "\"a\\\"b\""]]);
  });

  test("writes via jj config set --repo, never a --config CLI override or git config", () => {
    const { spawn, calls } = recorder();
    setJjSigningIdentity({ root: "/repo", identity: IDENTITY, spawn });
    expect(calls).toEqual([
      ["jj", "config", "set", "--repo", "signing.behavior", "\"own\""],
      ["jj", "config", "set", "--repo", "signing.backend", "\"gpg\""],
      ["jj", "config", "set", "--repo", "signing.key", "\"ABC123\""],
      ["jj", "config", "set", "--repo", "user.name", "\"Agent Name\""],
      ["jj", "config", "set", "--repo", "user.email", "\"agent@example.com\""],
    ]);
    expect(calls.some((cmd) => cmd.includes("--config"))).toBe(false);
  });

  test("surfaces a failing jj config set", () => {
    const { spawn } = recorder("signing.key");
    expect(() => setJjSigningIdentity({ root: "/repo", identity: IDENTITY, spawn }))
      .toThrow("jj config set signing.key failed (exit 3): refused");
  });

  test("maps WorktreeConfig agent credentials into the jj config write", () => {
    const config: WorktreeConfig = {
      repoRoot: "/repo",
      worktreeRoot: "/repo",
      treeDir: "/repo/tree",
      settings: DEFAULT_SETTINGS,
      agentGpgKeyId: IDENTITY.keyId,
      agentGpgName: IDENTITY.name,
      agentGpgEmail: IDENTITY.email,
    };
    const { spawn, calls } = recorder();
    configureJjSigning({ config, spawn });
    expect(calls).toContainEqual(["jj", "config", "set", "--repo", "signing.key", "\"ABC123\""]);
  });

  test("bypass keys and jj fix stay refused; repo config writes stay allowed", () => {
    for (
      const args of [
        ["--config", "signing.behavior=drop", "status"],
        ["--config=signing.backend=none", "status"],
        ["--config", "signing.key=evil", "commit"],
        ["--config", "signing.keys=evil", "commit"],
        ["fix"],
      ]
    ) {
      expect(classifyJjInvocation(args).verdict).toBe("block");
    }
    expect(classifyJjInvocation(["config", "set", "--repo", "signing.key", "\"X\""]).verdict)
      .toBe("pass");
  });

  test("skips jj config writes when no agent identity is configured", () => {
    const config: WorktreeConfig = {
      repoRoot: "/repo",
      worktreeRoot: "/repo",
      treeDir: "/repo/tree",
      settings: DEFAULT_SETTINGS,
    };
    const { spawn, calls } = recorder();
    expect(() => configureJjSigning({ config, spawn })).not.toThrow();
    expect(calls).toEqual([]);
  });

  test("maps a partial identity without inventing signing keys", () => {
    const config: WorktreeConfig = {
      repoRoot: "/repo",
      worktreeRoot: "/repo",
      treeDir: "/repo/tree",
      settings: DEFAULT_SETTINGS,
      agentGpgName: "Only Name",
    };
    const { spawn, calls } = recorder();
    configureJjSigning({ config, spawn });
    expect(calls).toEqual([["jj", "config", "set", "--repo", "user.name", "\"Only Name\""]]);
  });
});
