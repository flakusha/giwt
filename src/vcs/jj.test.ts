// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gitBackend } from "./git";
import {
  BOOKMARK_TEMPLATE,
  COUNT_TEMPLATE,
  jjBackend,
  type JjResult,
  type JjSpawn,
  makeJjBackend,
  WORKSPACE_TEMPLATE,
} from "./jj";
import { pijulBackend } from "./pijul";

const ROOT = "/repo";
type Reply = JjResult | string;

function stub(replies: Record<string, Reply> = {}) {
  const calls: string[][] = [];
  const cwds: string[] = [];
  const spawn: JjSpawn = (cmd, cwd) => {
    calls.push(cmd);
    cwds.push(cwd);
    const reply = replies[cmd.join(" ")] ?? "";
    return typeof reply === "string" ? { stdout: reply, stderr: "", exitCode: 0 } : reply;
  };
  return { spawn, calls, cwds };
}

const GUARD: Record<string, Reply> = {
  "jj --version": "jj 0.46.0\n",
  "jj git colocation status": "Workspace 'default' is currently colocated with Git.\n",
};
const g = (replies: Record<string, Reply>): Record<string, Reply> => ({ ...GUARD, ...replies });

function expectArgv(calls: string[][], expected: string[][]): void {
  expect(calls).toEqual(expected);
  for (const cmd of calls) expect(cmd[0]).toBe("jj");
}

const GUARD_ARGV = [["jj", "--version"], ["jj", "git", "colocation", "status"]];

describe("jjBackend (stubbed argv)", () => {
  test("exports a backend named jj and never falls back to git", async () => {
    expect(jjBackend.name).toBe("jj");
    const { spawn, calls } = stub(g({}));
    await makeJjBackend(spawn).listBranches(ROOT);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((cmd) => cmd[0] === "jj")).toBe(true);
  });

  test("listBranches parses bookmarks, marks the @ bookmark, skips absent/conflicted", async () => {
    const { spawn, calls, cwds } = stub(g({
      [`jj bookmark list --no-pager -T ${BOOKMARK_TEMPLATE}`]:
        "main|true|false|aaa\nfeature|true|false|bbb\ngone|false|false|ccc\nconf|true|true|ddd\n",
      "jj log -r @ --no-graph -T commit_id": "bbb\n",
    }));
    expect(await makeJjBackend(spawn).listBranches(ROOT)).toEqual([
      { name: "main", current: false },
      { name: "feature", current: true },
      { name: "conf", current: false },
    ]);
    expectArgv(calls, [
      ...GUARD_ARGV,
      ["jj", "bookmark", "list", "--no-pager", "-T", BOOKMARK_TEMPLATE],
      ["jj", "log", "-r", "@", "--no-graph", "-T", "commit_id"],
    ]);
    expect(cwds.every((cwd) => cwd === ROOT)).toBe(true);
  });

  test("listWorkspaces parses name/root and allows an empty root", async () => {
    const { spawn, calls } = stub(g({
      [`jj workspace list --no-pager -T ${WORKSPACE_TEMPLATE}`]:
        "default|/repo\nchild|/repo/child\nstale|\n",
    }));
    expect(await makeJjBackend(spawn).listWorkspaces(ROOT)).toEqual([
      { path: "/repo", branch: "" },
      { path: "/repo/child", branch: "" },
      { path: "", branch: "" },
    ]);
    expectArgv(calls, [
      ...GUARD_ARGV,
      ["jj", "workspace", "list", "--no-pager", "-T", WORKSPACE_TEMPLATE],
    ]);
  });

  test("status counts trunk()..@ / @..trunk() and reads cleanliness from jj diff", async () => {
    const { spawn, calls } = stub(g({
      "jj log -r trunk() --no-graph -T commit_id": "abc123\n",
      [`jj log -r trunk()..@ --no-graph -T ${COUNT_TEMPLATE}`]: "xx",
      [`jj log -r @..trunk() --no-graph -T ${COUNT_TEMPLATE}`]: "x",
      "jj diff --name-only": "a.txt\n",
    }));
    expect(await makeJjBackend(spawn).status(ROOT, "main")).toEqual({
      branch: "main",
      ahead: 2,
      behind: 1,
      clean: false,
    });
    expectArgv(calls, [
      ...GUARD_ARGV,
      ["jj", "log", "-r", "trunk()", "--no-graph", "-T", "commit_id"],
      ["jj", "log", "-r", "trunk()..@", "--no-graph", "-T", COUNT_TEMPLATE],
      ["jj", "log", "-r", "@..trunk()", "--no-graph", "-T", COUNT_TEMPLATE],
      ["jj", "diff", "--name-only"],
    ]);
  });

  test("status falls back to main/master when trunk() resolves to the root commit", async () => {
    const { spawn, calls } = stub(g({
      "jj log -r trunk() --no-graph -T commit_id": "0000000000000000000000000000000000000000\n",
      "jj log -r main --no-graph -T commit_id": { stdout: "", stderr: "no such rev", exitCode: 1 },
      "jj log -r master --no-graph -T commit_id": "deadbeef\n",
      [`jj log -r master..@ --no-graph -T ${COUNT_TEMPLATE}`]: "x",
      [`jj log -r @..master --no-graph -T ${COUNT_TEMPLATE}`]: "",
      "jj diff --name-only": "",
    }));
    expect(await makeJjBackend(spawn).status(ROOT, "feature")).toEqual({
      branch: "feature",
      ahead: 1,
      behind: 0,
      clean: true,
    });
    expectArgv(calls, [
      ...GUARD_ARGV,
      ["jj", "log", "-r", "trunk()", "--no-graph", "-T", "commit_id"],
      ["jj", "log", "-r", "main", "--no-graph", "-T", "commit_id"],
      ["jj", "log", "-r", "master", "--no-graph", "-T", "commit_id"],
      ["jj", "log", "-r", "master..@", "--no-graph", "-T", COUNT_TEMPLATE],
      ["jj", "log", "-r", "@..master", "--no-graph", "-T", COUNT_TEMPLATE],
      ["jj", "diff", "--name-only"],
    ]);
  });

  test("status falls back to root() when no remote and no main/master bookmark", async () => {
    const { spawn, calls } = stub(g({
      "jj log -r trunk() --no-graph -T commit_id": "0000000000000000000000000000000000000000\n",
      "jj log -r main --no-graph -T commit_id": { stdout: "", stderr: "x", exitCode: 1 },
      "jj log -r master --no-graph -T commit_id": { stdout: "", stderr: "x", exitCode: 1 },
      [`jj log -r root()..@ --no-graph -T ${COUNT_TEMPLATE}`]: "xxx",
      [`jj log -r @..root() --no-graph -T ${COUNT_TEMPLATE}`]: "",
      "jj diff --name-only": "",
    }));
    const result = await makeJjBackend(spawn).status(ROOT, "topic");
    expect(result.ahead).toBe(3);
    expect(calls).toContainEqual([
      "jj",
      "log",
      "-r",
      "root()..@",
      "--no-graph",
      "-T",
      COUNT_TEMPLATE,
    ]);
  });

  test("diff lists changed paths from the branch, empty when clean", async () => {
    const { spawn, calls } = stub(g({
      "jj diff --from main --name-only": "a.txt\nb.txt\n\n",
    }));
    const backend = makeJjBackend(spawn);
    expect(await backend.diff(ROOT, "main")).toEqual(["a.txt", "b.txt"]);
    expectArgv(calls, [...GUARD_ARGV, ["jj", "diff", "--from", "main", "--name-only"]]);

    const clean = stub(g({}));
    expect(await makeJjBackend(clean.spawn).diff(ROOT, "main")).toEqual([]);
  });

  test("commit commits the message then reads the parent commit id", async () => {
    const { spawn, calls, cwds } = stub(g({
      "jj commit -m ship it": "",
      "jj log -r @- --no-graph -T commit_id": "deadbeef\n",
    }));
    expect(await makeJjBackend(spawn).commit({ cwd: ROOT, message: "ship it" })).toEqual({
      sha: "deadbeef",
    });
    expectArgv(calls, [
      ...GUARD_ARGV,
      ["jj", "commit", "-m", "ship it"],
      ["jj", "log", "-r", "@-", "--no-graph", "-T", "commit_id"],
    ]);
    expect(cwds.every((cwd) => cwd === ROOT)).toBe(true);
  });

  test("createWorkspace adds a pinned named workspace, with and without a base revision", async () => {
    const plain = stub(g({}));
    await makeJjBackend(plain.spawn).createWorkspace({
      root: ROOT,
      path: "/repo/wt",
      branch: "feature",
    });
    expectArgv(plain.calls, [
      ...GUARD_ARGV,
      ["jj", "workspace", "add", "/repo/wt", "--name", "feature"],
      ["jj", "bookmark", "create", "feature", "-r", "feature@"],
    ]);

    const based = stub(g({}));
    await makeJjBackend(based.spawn).createWorkspace({
      root: ROOT,
      path: "/repo/wt",
      branch: "feature",
      base: "main",
    });
    expectArgv(based.calls, [
      ...GUARD_ARGV,
      ["jj", "workspace", "add", "/repo/wt", "--name", "feature", "--revision", "main"],
      ["jj", "bookmark", "create", "feature", "-r", "feature@"],
    ]);
  });

  test("removeWorkspace resolves the workspace name from its path before forgetting", async () => {
    const listing = `jj workspace list --no-pager -T ${WORKSPACE_TEMPLATE}`;
    const { spawn, calls } = stub(g({
      [listing]: "default|/repo\nchild|/repo/child\n",
    }));
    await makeJjBackend(spawn).removeWorkspace({ root: ROOT, path: "/repo/child" });
    expectArgv(calls, [
      ...GUARD_ARGV,
      ["jj", "workspace", "list", "--no-pager", "-T", WORKSPACE_TEMPLATE],
      ["jj", "workspace", "forget", "child"],
    ]);
  });

  test("removeWorkspace refuses an unknown path with an actionable message", async () => {
    const { spawn } = stub(g({
      [`jj workspace list --no-pager -T ${WORKSPACE_TEMPLATE}`]: "default|/repo\n",
    }));
    expect(
      makeJjBackend(spawn).removeWorkspace({ root: ROOT, path: "/nope" }),
    ).rejects.toThrow(".plan/tickets/FEAT-feat-jj-jujutsu-vcs-support.md");
  });

  test("renameWorkspace renames the workspace addressed by -R, never via git", async () => {
    const dir = mkdtempSync(join(tmpdir(), "giwt-jj-rename-"));
    const child = join(dir, "child");
    mkdirSync(child);
    try {
      const { spawn, calls, cwds } = stub(g({
        [`jj workspace list --no-pager -T ${WORKSPACE_TEMPLATE}`]:
          `default|${dir}\nchild|${child}\n`,
      }));
      await makeJjBackend(spawn).renameWorkspace({ root: dir, path: child, name: "renamed" });
      expectArgv(calls, [
        ...GUARD_ARGV,
        ["jj", "workspace", "list", "--no-pager", "-T", WORKSPACE_TEMPLATE],
        ["jj", "-R", child, "workspace", "rename", "renamed"],
      ]);
      expect(cwds.every((cwd) => cwd === dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("renameWorkspace refuses a missing checkout with a forget hint, no git fallback", async () => {
    const { spawn, calls } = stub(g({
      [`jj workspace list --no-pager -T ${WORKSPACE_TEMPLATE}`]:
        "default|/repo\nstale|/repo/gone\n",
    }));
    await expect(
      makeJjBackend(spawn).renameWorkspace({ root: ROOT, path: "/repo/gone", name: "new" }),
    ).rejects.toThrow("jj workspace forget stale");
    expect(calls.every((cmd) => cmd[0] === "jj")).toBe(true);
    expect(calls.some((cmd) => cmd.includes("worktree"))).toBe(false);
    expect(calls.some((cmd) => cmd[2] === "rename")).toBe(false);
  });

  test("git and pijul backends refuse renameWorkspace rather than silently succeeding", async () => {
    for (const backend of [gitBackend, pijulBackend]) {
      await expect(backend.renameWorkspace({ root: ROOT, path: "/repo/wt", name: "x" }))
        .rejects.toThrow("no rename");
    }
  });

  test("child workspace creation pins its bookmark and keeps jj 0.46 colocation", async () => {
    const { spawn, calls } = stub(g({}));
    await makeJjBackend(spawn).createWorkspace({
      root: ROOT,
      path: "/repo/child",
      branch: "feature",
    });
    const add = calls.find((cmd) => cmd[1] === "workspace" && cmd[2] === "add");
    expect(add).toBeDefined();
    expect(add).not.toContain("--no-colocate");
    expect(calls).toContainEqual(["jj", "bookmark", "create", "feature", "-r", "feature@"]);
  });
});

describe("jjBackend guards (err-closed)", () => {
  const actionable = (err: unknown): void => {
    const msg = err instanceof Error ? err.message : String(err);
    expect(msg).toContain(".plan/tickets/FEAT-feat-jj-jujutsu-vcs-support.md");
    expect(msg).toContain("[vcs] backend = \"git\"");
  };

  test("missing jj binary is refused", async () => {
    const { spawn } = stub({
      "jj --version": { stdout: "", stderr: "spawn jj ENOENT", exitCode: 127 },
    });
    try {
      await makeJjBackend(spawn).listBranches(ROOT);
      throw new Error("expected rejection");
    } catch (err) {
      actionable(err);
    }
  });

  test("old jj version is refused", async () => {
    const { spawn } = stub({ "jj --version": "jj 0.45.9\n" });
    try {
      await makeJjBackend(spawn).listBranches(ROOT);
      throw new Error("expected rejection");
    } catch (err) {
      actionable(err);
      expect((err as Error).message).toContain("too old");
    }
  });

  test("unparseable jj version is refused", async () => {
    const { spawn } = stub({ "jj --version": "unexpected output\n" });
    try {
      await makeJjBackend(spawn).listBranches(ROOT);
      throw new Error("expected rejection");
    } catch (err) {
      actionable(err);
      expect((err as Error).message).toContain("cannot parse jj version");
    }
  });

  test("non-colocated workspace is refused even when colocation status exits 0", async () => {
    const { spawn } = stub({
      "jj --version": "jj 0.46.0\n",
      "jj git colocation status": "Workspace 'default' is currently not colocated with Git.\n",
    });
    try {
      await makeJjBackend(spawn).listBranches(ROOT);
      throw new Error("expected rejection");
    } catch (err) {
      actionable(err);
      expect((err as Error).message).toContain("not colocated");
    }
  });

  test("colocation status failure is refused", async () => {
    const { spawn } = stub({
      "jj --version": "jj 0.46.0\n",
      "jj git colocation status": { stdout: "", stderr: "boom", exitCode: 1 },
    });
    try {
      await makeJjBackend(spawn).listBranches(ROOT);
      throw new Error("expected rejection");
    } catch (err) {
      actionable(err);
    }
  });
});

const realTest = Bun.which("jj") === undefined ? test.skip : test;

realTest("real jj binary parses bookmarks and workspaces in a colocated repo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "giwt-jj-backend-"));
  const config = join(dir, "jjconfig.toml");
  writeFileSync(config, "[user]\nname = \"Probe\"\nemail = \"probe@example.com\"\n");
  try {
    const init = Bun.spawnSync(["jj", "git", "init", "--colocate"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, JJ_CONFIG: config },
    });
    expect(init.exitCode).toBe(0);
    const bookmark = Bun.spawnSync(["jj", "bookmark", "create", "testbook"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, JJ_CONFIG: config },
    });
    expect(bookmark.exitCode).toBe(0);

    const realSpawn: JjSpawn = (cmd, cwd) => {
      const proc = Bun.spawnSync(cmd, {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        env: { ...process.env, JJ_CONFIG: config },
      });
      return {
        stdout: proc.stdout.toString(),
        stderr: proc.stderr.toString(),
        exitCode: proc.exitCode ?? 1,
      };
    };
    const backend = makeJjBackend(realSpawn);
    const branches = await backend.listBranches(dir);
    expect(branches).toContainEqual({ name: "testbook", current: true });
    const workspaces = await backend.listWorkspaces(dir);
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]?.branch).toBe("");
    const status = await backend.status(dir, "testbook");
    expect(status.branch).toBe("testbook");
    expect(Number.isInteger(status.ahead)).toBe(true);
    expect(typeof status.clean).toBe("boolean");
    expect(Array.isArray(await backend.diff(dir, "testbook"))).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

realTest("jj 0.46 child workspace stays colocated and carries its pinned bookmark", async () => {
  const dir = mkdtempSync(join(tmpdir(), "giwt-jj-child-"));
  const config = join(dir, "jjconfig.toml");
  writeFileSync(config, "[user]\nname = \"Probe\"\nemail = \"probe@example.com\"\n");
  const env = { ...process.env, JJ_CONFIG: config };
  try {
    const init = Bun.spawnSync(["jj", "git", "init", "--colocate"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    expect(init.exitCode).toBe(0);
    const spawn: JjSpawn = (cmd, cwd) => {
      const proc = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe", env });
      return {
        stdout: proc.stdout.toString(),
        stderr: proc.stderr.toString(),
        exitCode: proc.exitCode ?? 1,
      };
    };
    const child = join(dir, "child");
    await makeJjBackend(spawn).createWorkspace({ root: dir, path: child, branch: "feature" });
    expect(existsSync(resolve(child, ".git"))).toBe(true);
    const pinned = spawn(["jj", "log", "-r", "feature@", "--no-graph", "-T", "bookmarks"], child);
    expect(pinned.stdout).toContain("feature");
    const coloc = spawn(["jj", "git", "colocation", "status"], child);
    expect(coloc.stdout).toContain("is currently colocated with Git.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
