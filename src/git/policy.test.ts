// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import { classifyGitInvocation, parseGlobalArgs } from "./policy";
import type { GitPolicyLists } from "./policy";

const NO_FS = { pathExists: () => false };

function verdict(args: string[], lists?: GitPolicyLists) {
  return classifyGitInvocation(args, lists, NO_FS);
}

describe("parseGlobalArgs", () => {
  test("splits global option block from subcommand", () => {
    expect(parseGlobalArgs(["--no-pager", "-C", "/tmp", "status"])).toEqual({
      rest: ["status"],
    });
    expect(parseGlobalArgs(["-C/tmp", "status"]).rest).toEqual(["status"]);
    expect(parseGlobalArgs(["--git-dir=/x", "log"]).rest).toEqual(["log"]);
    expect(parseGlobalArgs(["--", "status"]).rest).toEqual(["status"]);
  });

  test("--config-env and -c misuses error", () => {
    expect(parseGlobalArgs(["-c", "nokey"]).error).toContain("key=value");
    expect(parseGlobalArgs(["--config-env"]).error).toContain("key=VAR");
    expect(parseGlobalArgs(["--config-env=credential.helper=V", "fetch"]).error).toBeTruthy();
    expect(parseGlobalArgs(["-ccredential.helper=evil", "fetch"]).error).toBeTruthy();
  });

  test("no-value global options consume only themselves", () => {
    expect(parseGlobalArgs(["--exec-path", "log"]).rest).toEqual(["log"]);
    expect(parseGlobalArgs(["-P", "status"]).rest).toEqual(["status"]);
  });

  test("refuses unknown global options (err-closed)", () => {
    expect(parseGlobalArgs(["--bogus", "status"]).error).toContain("--bogus");
  });

  test("-c gpg disable is refused; other one-shot overrides pass", () => {
    expect(parseGlobalArgs(["-c", "commit.gpgsign=false", "commit", "-m", "x"]).error).toBeTruthy();
    expect(parseGlobalArgs(["-ccommit.gpgsign=0", "commit"]).error).toBeTruthy();
    expect(parseGlobalArgs(["-c", "tag.gpgsign=no", "tag"]).error).toBeTruthy();
    expect(parseGlobalArgs(["-c", "core.editor=true", "commit"]).error).toBeUndefined();
    expect(parseGlobalArgs(["-c", "core.editor=true", "commit"]).rest).toEqual(["commit"]);
  });

  test("credential/hook/ssh overrides are refused regardless of value", () => {
    expect(parseGlobalArgs(["-c", "credential.helper=evil", "fetch"]).error).toBeTruthy();
    expect(parseGlobalArgs(["-c", "core.hooksPath=/evil", "status"]).error).toBeTruthy();
    expect(parseGlobalArgs(["-c", "core.sshCommand=evil", "push"]).error).toBeTruthy();
    // Pinned identity: one-shot user.name/user.email overrides are refused.
    expect(parseGlobalArgs(["-c", "user.email=sneaky@evil", "commit", "-m", "x"]).error)
      .toBeTruthy();
    expect(parseGlobalArgs(["-c", "user.name=sneaky", "commit", "-m", "x"]).error).toBeTruthy();
    expect(parseGlobalArgs(["-cuser.name=sneaky", "commit"]).error).toBeTruthy();
    expect(parseGlobalArgs(["--config-env", "commit.gpgsign=SECRET", "commit"]).error).toBeTruthy();
    expect(parseGlobalArgs(["--config-env=core.hooksPath=V", "status"]).error).toBeTruthy();
  });
});

describe("classifyGitInvocation — read-only pass", () => {
  test("common reads pass", () => {
    for (
      const args of [
        ["status"],
        ["log", "--oneline", "-5"],
        ["--no-pager", "diff", "HEAD~1"],
        ["rev-parse", "HEAD"],
        ["ls-files"],
        ["cat-file", "-p", "HEAD"],
        ["config", "--get", "user.name"],
        ["config", "--get-regexp", "^user\\."],
        ["config", "--list"],
        ["config", "user.name"],
        ["config", "get", "user.name"],
        ["config", "list"],
        ["config", "--file", "/tmp/other", "--get", "x"],
        ["branch"],
        ["tag", "-l"],
        ["remote", "-v"],
        ["reflog"],
      ]
    ) {
      expect(verdict(args).verdict, args.join(" ")).toBe("pass");
    }
  });
});

describe("classifyGitInvocation — mutating-but-recoverable pass", () => {
  test("safe mutation shapes pass", () => {
    for (
      const args of [
        ["add", "file.txt"],
        ["commit", "-m", "feat: x"],
        ["commit", "-mfeat", "--", "f"],
        ["commit", "--amend", "--no-edit"],
        ["merge", "--ff-only", "origin/main"],
        ["rebase", "main"],
        ["rebase", "--continue"],
        ["checkout", "-b", "feat"],
        ["checkout", "main"],
        ["switch", "-c", "feat"],
        ["restore", "--staged", "f.txt"],
        ["push", "origin", "main"],
        ["push", "--force-with-lease", "origin", "main"],
        ["reset", "--soft", "HEAD~1"],
        ["stash", "push"],
        ["stash", "pop"],
        ["rm", "--cached", "f.txt"],
        ["worktree", "add", "../wt", "feat"],
        ["fetch", "origin"],
        ["branch", "-d", "old"],
        ["tag", "v1"],
      ]
    ) {
      expect(verdict(args).verdict, args.join(" ")).toBe("pass");
    }
  });
});

describe("classifyGitInvocation — destructive and gpg blocks", () => {
  test("cc-safety-net seeded destructive shapes block", () => {
    for (
      const args of [
        ["reset", "--hard"],
        ["reset", "--merge"],
        ["clean", "-fdx"],
        ["clean"],
        ["checkout", "--", "f.txt"],
        ["checkout", "."],
        ["checkout", "../x"],
        ["checkout", "main", "--", "f.txt"],
        ["checkout", "--force"],
        ["checkout", "-f"],
        ["checkout", "--pathspec-from-file=paths"],
        ["restore", "f.txt"],
        ["restore", "--worktree", "f.txt"],
        ["restore", "--source", "HEAD~1", "f.txt"],
        ["switch", "--discard-changes"],
        ["switch", "-f", "main"],
        ["push", "--force", "origin", "main"],
        ["push", "-f"],
        ["push", "origin", "+main:main"],
        ["branch", "-D", "feat"],
        ["branch", "-df", "feat"],
        ["branch", "-d", "--force", "feat"],
        ["tag", "-d", "v1"],
        ["tag", "--delete", "v1"],
        ["stash", "drop"],
        ["stash", "clear"],
        ["rebase", "--abort"],
        ["merge", "--abort"],
        ["cherry-pick", "--abort"],
        ["rm", "-f", "f.txt"],
        ["rm", "--force", "f.txt"],
        ["worktree", "remove", "--force", "../wt"],
        ["reflog", "expire", "--all"],
        ["reflog", "delete", "HEAD@{1}"],
        ["update-ref", "-d", "refs/heads/x"],
        ["symbolic-ref", "-d", "HEAD"],
        ["replace", "-d", "sha"],
        ["gc"],
        ["maintenance", "run"],
        ["filter-branch", "--all"],
        ["filter-repo"],
        ["bisect", "run", "make"],
        ["add", "-p"],
        ["rebase", "-i", "main"],
        ["checkout", "-p"],
        ["stash", "push", "-p"],
        ["restore", "-p", "f.txt"],
      ]
    ) {
      expect(verdict(args).verdict, args.join(" ")).toBe("block");
    }
  });

  test("gpg gating removal blocks everywhere", () => {
    expect(verdict(["commit", "--no-gpg-sign", "-m", "x"]).verdict).toBe("block");
    expect(verdict(["tag", "v1", "--no-sign"]).verdict).toBe("block");
    expect(verdict(["rebase", "--no-gpg-sign", "main"]).verdict).toBe("block");
  });

  test("config writes block in every shape", () => {
    for (
      const args of [
        ["config", "user.name", "x"],
        ["config", "--global", "user.name", "x"],
        ["-C", "/tmp", "config", "a.b", "c"],
        ["config", "set", "a.b", "c"],
        ["config", "unset", "a.b"],
        ["config", "unset-all", "a.b", "v"],
        ["config", "add", "a.b", "v"],
        ["config", "replace-all", "a.b", "v"],
        ["config", "edit"],
        ["config", "-e"],
        ["config", "remove-section", "a"],
        ["config", "rename-section", "a", "b"],
        ["config", "--add", "a.b"],
        ["config", "--unset", "a.b"],
      ]
    ) {
      expect(verdict(args).verdict, args.join(" ")).toBe("block");
    }
  });

  test("commit --author is refused — identity is pinned to repo credentials", () => {
    expect(verdict(["commit", "--author", "Evil <e@evil>", "-m", "x"]).verdict).toBe("block");
    expect(verdict(["commit", "--author=Evil <e@evil>", "-m", "x"]).verdict).toBe("block");
  });

  test("one-shot user identity overrides block through classification", () => {
    expect(verdict(["-c", "user.email=sneaky@evil", "commit", "-m", "x"]).verdict).toBe("block");
    expect(verdict(["-c", "user.name=sneaky", "commit", "-m", "x"]).verdict).toBe("block");
  });

  test("editor-requiring commit shapes block", () => {
    for (
      const args of [
        ["commit"],
        ["commit", "--amend"],
        ["commit", "--allow-empty-message"],
        ["commit", "-e"],
        ["commit", "--patch"],
      ]
    ) {
      expect(verdict(args).verdict, args.join(" ")).toBe("block");
    }
  });
});

describe("classifyGitInvocation — rebase --exec payload identity guard", () => {
  const PAYLOADS = [
    "export GIT_AUTHOR_NAME=Evil; git commit --amend --no-edit",
    "export git_committer_email=evil@x; git commit --amend --no-edit",
    "git -c user.name=Evil commit --amend --no-edit",
    "git -c user.email=evil@x commit --amend --no-edit",
    "git commit --amend --no-edit --author=Evil <e@evil>",
    "git commit --amend --author \"Evil <e@evil>\" --no-edit",
    "git -c commit.gpgsign=false commit --amend",
  ];

  test("identity-override payloads are refused in every --exec/-x shape", () => {
    for (const payload of PAYLOADS) {
      for (
        const args of [
          ["rebase", "--exec", payload, "main"],
          ["rebase", "-x", payload, "main"],
          ["rebase", `-x${payload}`, "main"],
          ["rebase", `--exec=${payload}`, "main"],
          ["rebase", `-x=${payload}`, "main"],
          ["rebase", "main", "--exec", payload],
          ["rebase", "--exec", `'${payload}'`, "main"],
        ]
      ) {
        const v = verdict(args);
        expect(v.verdict, args.join(" ")).toBe("block");
        expect(v.reason).toContain("--exec");
      }
    }
  });

  test("benign and absent payloads still pass", () => {
    expect(verdict(["rebase", "--exec", "make test", "main"]).verdict).toBe("pass");
    expect(verdict(["rebase", "-x", "bun test src/git", "main"]).verdict).toBe("pass");
    expect(verdict(["rebase", "--exec=make test", "main"]).verdict).toBe("pass");
    expect(verdict(["rebase", "-xmake test", "main"]).verdict).toBe("pass");
    expect(verdict(["rebase", "main"]).verdict).toBe("pass");
    expect(verdict(["rebase", "--onto", "main", "feat"]).verdict).toBe("pass");
  });

  test("existing rebase refusals still hold", () => {
    expect(verdict(["rebase", "--abort"]).verdict).toBe("block");
    expect(verdict(["rebase", "-i", "main"]).verdict).toBe("block");
    expect(verdict(["rebase", "--interactive", "main"]).verdict).toBe("block");
  });
});

describe("classifyGitInvocation — err-closed unknowns", () => {
  test("unknown subcommand blocks with hint", () => {
    const v = verdict(["frobnicate"]);
    expect(v.verdict).toBe("block");
    expect(v.reason).toContain("[git] allow");
  });

  test("no subcommand blocks", () => {
    expect(verdict([]).verdict).toBe("block");
  });

  test("checkout of an existing entry (injected probe) blocks", () => {
    const v = classifyGitInvocation(["checkout", "src"], undefined, { pathExists: () => true });
    expect(v.verdict).toBe("block");
  });

  test("default pathExists probe classifies against the real fs", () => {
    // No injected pathExists: FALLBACK_PATH_EXISTS runs (cwd-relative).
    expect(classifyGitInvocation(["checkout", "definitely-not-a-file-or-branch"]).verdict).toBe(
      "pass",
    );
    expect(classifyGitInvocation(["checkout", "package.json"]).verdict).toBe("block");
  });

  test("magic-pathspec and attached force-cluster shapes block", () => {
    expect(verdict(["checkout", "HEAD~1:src/app.ts"]).verdict).toBe("block");
    expect(verdict(["worktree", "remove", "-f", "../wt"]).verdict).toBe("block");
  });
});

describe("classifyGitInvocation — configurable lists", () => {
  const lists: GitPolicyLists = {
    safe: ["secret-tool"],
    allow: ["deploy"],
    deny: ["status"],
  };

  test("[git] safe acts as read-only", () => {
    expect(verdict(["secret-tool"], lists).verdict).toBe("pass");
  });

  test("[git] allow admits otherwise-unknown subcommands", () => {
    expect(verdict(["deploy"], lists).verdict).toBe("pass");
  });

  test("[git] deny wins over tables, safe, and allow", () => {
    expect(verdict(["status"], lists).verdict).toBe("block");
    expect(
      verdict(["deploy"], { safe: [], allow: ["deploy"], deny: ["deploy"] }).verdict,
    ).toBe("block");
  });

  test("deny never unblocks built-in blocks", () => {
    expect(verdict(["clean"], lists).verdict).toBe("block");
  });
});
