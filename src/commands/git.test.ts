// SPDX-License-Identifier: AGPL-3.0-or-later
import { scratchRoot } from "../utils/scratch-tmp";
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { isolatedGitEnv } from "../utils/git";
import { beginRun, finishActiveRun } from "../utils/runlog";
import { DEFAULT_SETTINGS, type GiwtSettings } from "../utils/settings";
import { gitPassthrough } from "./git";

function git(root: string, ...args: string[]): string {
  const r = Bun.spawnSync(["git", "-C", root, ...args], {
    env: isolatedGitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`);
  }
  return r.stdout.toString();
}

function makeRepo(): string {
  const root = mkdtempSync(join(scratchRoot(), "giwt-gitcmd-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "giwt-test@localhost");
  git(root, "config", "user.name", "giwt test");
  writeFileSync(join(root, "a.txt"), "a\n");
  git(root, "add", "a.txt");
  git(root, "commit", "-q", "-m", "base");
  return root;
}

describe("giwt git passthrough", () => {
  let root: string;
  let config: WorktreeConfig;
  let outChunks: string[];
  let errChunks: string[];
  let outSpy: ReturnType<typeof spyOn>;
  let errSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    process.exitCode = 0;
    root = makeRepo();
    config = {
      repoRoot: root,
      worktreeRoot: root,
      treeDir: root,
      settings: DEFAULT_SETTINGS,
    } as unknown as WorktreeConfig;
    outChunks = [];
    errChunks = [];
    outSpy = spyOn(process.stdout, "write").mockImplementation(
      ((chunk: unknown) => {
        outChunks.push(String(chunk));
        return true;
      }) as never,
    );
    errSpy = spyOn(process.stderr, "write").mockImplementation(
      ((chunk: unknown) => {
        errChunks.push(String(chunk));
        return true;
      }) as never,
    );
  });

  afterEach(() => {
    outSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    rmSync(root, { recursive: true, force: true });
  });

  const settingsWith = (gitOverride: Partial<GiwtSettings["git"]>): WorktreeConfig =>
    ({
      ...config,
      settings: { ...DEFAULT_SETTINGS, git: { ...DEFAULT_SETTINGS.git, ...gitOverride } },
    }) as unknown as WorktreeConfig;

  test("read-only command passes through with git's output", async () => {
    await gitPassthrough(["status"], settingsWith({ rtk: "off" }));
    expect(process.exitCode).toBe(0);
    expect(outChunks.join("")).toContain("On branch main");
  });

  test("git's non-zero exit code is passed through", async () => {
    await gitPassthrough(["rev-parse", "definitely-not-a-ref"], settingsWith({ rtk: "off" }));
    expect(process.exitCode).toBe(128);
    expect(errChunks.join("")).toContain("definitely-not-a-ref");
  });

  test("config writes are blocked and the repo stays unmutated", async () => {
    await gitPassthrough(["config", "gate.probe", "injected"], config);
    expect(process.exitCode).toBe(1);
    expect(errChunks.join("")).toContain("blocked");
    const value = Bun.spawnSync(["git", "-C", root, "config", "--get", "gate.probe"], {
      env: isolatedGitEnv(),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(value.stdout.toString()).toBe("");
  });

  test("destructive commands are blocked", async () => {
    await gitPassthrough(["reset", "--hard"], config);
    expect(process.exitCode).toBe(1);
    expect(errChunks.join("")).toContain("reset --hard");

    process.exitCode = 0;
    await gitPassthrough(["push", "--force"], config);
    expect(process.exitCode).toBe(1);
  });

  test("gpg bypass is blocked", async () => {
    writeFileSync(join(root, "b.txt"), "b\n");
    git(root, "add", "b.txt");
    await gitPassthrough(["commit", "--no-gpg-sign", "-m", "evil"], config);
    expect(process.exitCode).toBe(1);
    expect(errChunks.join("")).toContain("GPG");
  });

  test("commit strips LLM co-authors, keeps real ones", async () => {
    writeFileSync(join(root, "c.txt"), "c\n");
    git(root, "add", "c.txt");
    const message = [
      "feat: trailer test",
      "",
      "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>",
      "Co-Authored-By: Jane Doe <jane@example.com>",
    ].join("\n");
    await gitPassthrough(["commit", "-m", message], settingsWith({ rtk: "off" }));
    expect(process.exitCode).toBe(0);
    const body = git(root, "log", "-1", "--format=%B");
    expect(body).toContain("Jane Doe");
    expect(body).not.toContain("Claude");
    expect(errChunks.join("")).toContain("stripped 1 LLM Co-Authored-By");
  });

  test("commit --author is blocked and the repo stays unmutated", async () => {
    await gitPassthrough(
      ["commit", "--author", "Evil <e@evil>", "-m", "evil author"],
      settingsWith({ rtk: "off" }),
    );
    expect(process.exitCode).toBe(1);
    expect(errChunks.join("")).toContain("--author");
    expect(git(root, "rev-list", "--count", "HEAD").trim()).toBe("1");
  });

  test("one-shot user.email override is blocked (pinned identity)", async () => {
    await gitPassthrough(
      ["-c", "user.email=sneaky@evil", "commit", "-m", "spoofed"],
      settingsWith({ rtk: "off" }),
    );
    expect(process.exitCode).toBe(1);
    expect(errChunks.join("")).toContain("blocked");
    expect(git(root, "rev-list", "--count", "HEAD").trim()).toBe("1");
  });

  test("commit with a literal \\n sequence in -m is blocked", async () => {
    await gitPassthrough(["commit", "-m", "feat: x\\n\\nbody"], settingsWith({ rtk: "off" }));
    expect(process.exitCode).toBe(1);
    expect(errChunks.join("")).toContain("escape sequence");
    expect(git(root, "rev-list", "--count", "HEAD").trim()).toBe("1");
  });

  test("commit with an over-wide subject is blocked", async () => {
    await gitPassthrough(
      ["commit", "-m", `feat: ${"x".repeat(80)}`],
      settingsWith({ rtk: "off" }),
    );
    expect(process.exitCode).toBe(1);
    expect(errChunks.join("")).toContain("max 72");
  });

  test("run record captures full output and the git:<sub> event", async () => {
    const rec = beginRun(config, "git", ["status"], null, "main");
    try {
      await gitPassthrough(["status"], config);
      expect(process.exitCode).toBe(0);
      expect(rec).not.toBeNull();
      const capture = join(rec!.dir, "git-output.txt");
      expect(existsSync(capture)).toBe(true);
      expect(readFileSync(capture, "utf-8")).toContain("On branch main");
      const events = readFileSync(join(rec!.dir, "events.jsonl"), "utf-8");
      expect(events).toContain("\"step\":\"git:status\"");
    } finally {
      // finish AND clear ACTIVE_RUN — a finished-but-cached run would leak
      // its dir into later finalize gate steps in the same test process.
      finishActiveRun(0);
    }
  });

  test("rtk off prints raw bytes; rtk auto keeps exit 0 with output", async () => {
    await gitPassthrough(["log", "--oneline", "-1"], settingsWith({ rtk: "off" }));
    const rawOut = outChunks.join("");
    expect(rawOut).toContain("base");

    outChunks = [];
    await gitPassthrough(["log", "--oneline", "-1"], settingsWith({ rtk: "auto" }));
    expect(process.exitCode).toBe(0);
    expect(outChunks.join("")).toContain("base");
  });

  test("invalid rtk setting warns and behaves as auto", async () => {
    await gitPassthrough(["log", "--oneline", "-1"], settingsWith({ rtk: "bogus" }));
    expect(process.exitCode).toBe(0);
    expect(errChunks.join("")).toContain("invalid");
  });

  test("attached -m message is trailer-filtered", async () => {
    writeFileSync(join(root, "d.txt"), "d\n");
    git(root, "add", "d.txt");
    await gitPassthrough(
      ["commit", "-mfeat: attached\n\nCo-Authored-By: Claude <noreply@anthropic.com>"],
      settingsWith({ rtk: "off" }),
    );
    expect(process.exitCode).toBe(0);
    const body = git(root, "log", "-1", "--format=%B");
    expect(body).toContain("feat: attached");
    expect(body).not.toContain("Claude");
  });

  test("-F message file is trailer-filtered via a rewritten path", async () => {
    writeFileSync(join(root, "e.txt"), "e\n");
    git(root, "add", "e.txt");
    const msgFile = join(root, "MSG");
    writeFileSync(
      msgFile,
      "feat: from file\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n",
    );
    const before = readdirSync(scratchRoot()).filter((n) => n.startsWith("giwt-git-msg-"));
    await gitPassthrough(["commit", "-F", msgFile], settingsWith({ rtk: "off" }));
    expect(process.exitCode).toBe(0);
    const body = git(root, "log", "-1", "--format=%B");
    expect(body).toContain("feat: from file");
    expect(body).not.toContain("Claude");
    // Throwaway filtered copy (no active run) must not outlive the spawn.
    const leaked = readdirSync(scratchRoot()).filter((n) =>
      n.startsWith("giwt-git-msg-") && !before.includes(n)
    );
    expect(leaked).toEqual([]);
  });

  test("unreadable -F path surfaces git's own error", async () => {
    writeFileSync(join(root, "f.txt"), "f\n");
    git(root, "add", "f.txt");
    await gitPassthrough(["commit", "-F", join(root, "nope.txt")], settingsWith({ rtk: "off" }));
    expect(process.exitCode).not.toBe(0);
    expect(errChunks.join("")).toContain("nope.txt");
  });

  test("empty invocation and unsupported classifier refuse", async () => {
    await gitPassthrough([], config);
    expect(process.exitCode).toBe(1);

    process.exitCode = 0;
    await gitPassthrough(["status"], settingsWith({ classify: "llm" }));
    expect(process.exitCode).toBe(1);
    expect(errChunks.join("")).toContain("not supported yet");
  });
});
