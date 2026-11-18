// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BOOKMARK_TEMPLATE, type JjResult, type JjSpawn } from "./jj";
import { currentJjBookmark, evidenceBranch } from "./jj-bookmark";

const ROOT = "/repo/child";

function stub(listing: string): { spawn: JjSpawn; calls: string[][]; } {
  const calls: string[][] = [];
  const replies: Record<string, JjResult> = {
    "jj --version": { stdout: "jj 0.46.0\n", stderr: "", exitCode: 0 },
    "jj git colocation status": {
      stdout: "Workspace 'child' is currently colocated with Git.\n",
      stderr: "",
      exitCode: 0,
    },
    [`jj bookmark list --no-pager -T ${BOOKMARK_TEMPLATE}`]: {
      stdout: listing,
      stderr: "",
      exitCode: 0,
    },
    "jj log -r @ --no-graph -T commit_id": {
      stdout: "bbb\n",
      stderr: "",
      exitCode: 0,
    },
  };
  const spawn: JjSpawn = (cmd, cwd) => {
    calls.push(cmd);
    if (cwd !== ROOT) throw new Error(`unexpected cwd ${cwd}`);
    return replies[cmd.join(" ")]
      ?? { stdout: "", stderr: `unexpected ${cmd.join(" ")}`, exitCode: 1 };
  };
  return { spawn, calls };
}

describe("currentJjBookmark", () => {
  test("records the bookmark pinned on this workspace's @, never a git branch", async () => {
    const { spawn, calls } = stub("main|true|false|aaa\nfeature|true|false|bbb\n");
    expect(await currentJjBookmark({ root: ROOT, spawn })).toBe("feature");
    expect(calls.every((cmd) => cmd[0] === "jj")).toBe(true);
  });

  test("records an empty branch when no bookmark points at @", async () => {
    const { spawn } = stub("main|true|false|aaa\n");
    expect(await currentJjBookmark({ root: ROOT, spawn })).toBe("");
  });

  test("evidenceBranch dispatches jj mode to the bookmark resolver", async () => {
    const { spawn } = stub("feature|true|false|bbb\n");
    expect(await evidenceBranch({ root: ROOT, backend: "jj", spawn })).toBe("feature");
  });

  test("evidenceBranch keeps the git branch probe for other backends", async () => {
    const dir = mkdtempSync(join(tmpdir(), "giwt-evidence-"));
    try {
      const init = Bun.spawnSync(["git", "init", "-b", "probe-branch", dir], {
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(init.exitCode).toBe(0);
      expect(await evidenceBranch({ root: dir, backend: "git" })).toBe("probe-branch");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
