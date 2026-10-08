// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Real-subprocess tests for the .githooks/commit-msg LLM trailer gate.
 *
 * Resource contract (parallel-safe): EVERY test owns a private
 * mkdtempSync(join(tmpdir(), "giwt-commit-msg-")) fixture dir containing
 * a fresh `git init` repo (so the hook's `git rev-parse --show-toplevel`
 * resolves inside the fixture) plus its own message files and optional
 * $HOME with a private .credentials.env. Everything is removed in the
 * file-level afterEach. Git runs with isolatedGitEnv() so the ambient
 * GIT_* hook context cannot poison the fixture.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolatedGitEnv } from "../src/utils/git";

const HOOK = new URL("./commit-msg", import.meta.url).pathname;

const LLM_TRAILER = "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>";

let dir = "";

const tempRoots: string[] = [];
afterEach(() => {
  for (const r of tempRoots.splice(0)) rmSync(r, { recursive: true, force: true });
  dir = "";
});

function makeRepo(): string {
  dir = mkdtempSync(join(tmpdir(), "giwt-commit-msg-"));
  tempRoots.push(dir);
  const repo = join(dir, "repo");
  Bun.spawnSync(["git", "init", "-q", repo], { env: isolatedGitEnv() });
  return repo;
}

/** Run the hook against a message; HOME points at the fixture dir so a
 *  test-private .credentials.env (if any) is the one the hook sees. */
function runHook(repo: string, name: string, body: string): {
  exitCode: number;
  stderr: string;
  msg: () => string;
} {
  const f = join(dir, name);
  writeFileSync(f, body);
  const r = Bun.spawnSync(["sh", HOOK, f], {
    cwd: repo,
    env: { ...isolatedGitEnv(), HOME: dir },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: r.exitCode ?? -1,
    stderr: r.stderr.toString(),
    msg: () => readFileSync(f, "utf8"),
  };
}

function writeCreds(body: string): void {
  writeFileSync(join(dir, ".credentials.env"), body);
}

describe("commit-msg LLM trailer gate", () => {
  test("strips the canonical LLM trailer, keeps the rest", () => {
    const repo = makeRepo();
    const r = runHook(repo, "msg.txt", `feat: x\n\n${LLM_TRAILER}\n`);
    expect(r.exitCode).toBe(0);
    expect(r.msg()).toBe("feat: x\n\n");
    expect(r.stderr).toContain("stripped 1 LLM Co-Authored-By trailer");
    expect(r.stderr).toContain("noreply@anthropic.com");
  });

  test("strips each vendor on the denylist (case-insensitive)", () => {
    const repo = makeRepo();
    const r = runHook(
      repo,
      "msg.txt",
      "s\n\n"
        + "Co-Authored-By: GPT-5 <noreply@openai.com>\n"
        + "CO-AUTHORED-BY: gemini-pro <noreply@google.com>\n"
        + "Co-Authored-By: copilot <noreply@github.com>\n",
    );
    expect(r.exitCode).toBe(0);
    expect(r.msg()).toBe("s\n\n");
    expect(r.stderr).toContain("stripped 3");
  });

  test("leaves non-placeholder human trailers untouched (WARNs with no canonical)", () => {
    const repo = makeRepo();
    const body = "feat: x\n\nCo-Authored-By: Alice <alice@human.dev>\n";
    const r = runHook(repo, "msg.txt", body);
    expect(r.exitCode).toBe(0);
    expect(r.msg()).toBe(body);
    // No canonical user.email in the fixture: the identity gate WARNs, never fails.
    expect(r.stderr).toContain("WARN: no configured user.email");
  });

  test("refuses a placeholder Co-authored-by even without a canonical", () => {
    const repo = makeRepo();
    const body = "feat: x\n\nCo-Authored-By: Alice <alice@example.com>\n";
    const r = runHook(repo, "msg.txt", body);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("placeholder identity");
  });

  test("ALLOWED_TRAILERS consent outranks the placeholder heuristic for trailers", () => {
    const repo = makeRepo();
    writeCreds("ALLOWED_TRAILERS=\"alice@example.com\"\n");
    const body = "feat: x\n\nCo-Authored-By: Alice <alice@example.com>\n";
    const r = runHook(repo, "msg.txt", body);
    expect(r.exitCode).toBe(0);
    expect(r.msg()).toBe(body);
    expect(r.stderr).toContain("kept consented trailer");
  });

  test("refuses a Co-authored-by that mismatches a configured canonical", () => {
    const repo = makeRepo();
    // Configure the canonical identity in the fixture repo's config file
    // directly (git config writes are prohibited for agents).
    appendFileSync(
      join(repo, ".git", "config"),
      "[user]\n\temail = canonical@human.dev\n\tname = Human\n",
    );
    const body = "feat: x\n\nCo-Authored-By: Mallory <mallory@human.dev>\n";
    const r = runHook(repo, "msg.txt", body);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("does not match the repo-canonical identity");
  });

  test("keeps a Co-authored-by that matches a configured canonical", () => {
    const repo = makeRepo();
    appendFileSync(
      join(repo, ".git", "config"),
      "[user]\n\temail = canonical@human.dev\n\tname = Human\n",
    );
    const body = "feat: x\n\nCo-Authored-By: Human <canonical@human.dev>\n";
    const r = runHook(repo, "msg.txt", body);
    expect(r.exitCode).toBe(0);
    expect(r.msg()).toBe(body);
  });

  test("messages without trailers pass through unchanged", () => {
    const repo = makeRepo();
    const body = "feat: x\n\nbody text\n";
    const r = runHook(repo, "msg.txt", body);
    expect(r.exitCode).toBe(0);
    expect(r.msg()).toBe(body);
    expect(r.stderr).toBe("");
  });

  test("ALLOWED_TRAILERS in .credentials.env exempts a matched trailer", () => {
    const repo = makeRepo();
    writeCreds("ALLOWED_TRAILERS=\"agent@z.ai, team-bot@anthropic.example\"\n");
    const r = runHook(
      repo,
      "msg.txt",
      "feat: x\n\n"
        + "Co-Authored-By: Z.ai Agent <agent@z.ai>\n"
        + `${LLM_TRAILER}\n`,
    );
    expect(r.exitCode).toBe(0);
    expect(r.msg()).toBe("feat: x\n\nCo-Authored-By: Z.ai Agent <agent@z.ai>\n");
    expect(r.stderr).toContain("stripped 1");
    expect(r.stderr).toContain("kept allow-listed trailer");
  });

  test("allowlist only exempts matching lines, not the whole vendor", () => {
    const repo = makeRepo();
    writeCreds("ALLOWED_TRAILERS=\"agent@z.ai\"\n");
    const r = runHook(repo, "msg.txt", `feat: x\n\n${LLM_TRAILER}\n`);
    expect(r.exitCode).toBe(0);
    expect(r.msg()).toBe("feat: x\n\n");
  });

  test("rejects a literal backslash-n sequence", () => {
    const repo = makeRepo();
    const r = runHook(repo, "msg.txt", "feat: x\\n\\nbody\n");
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("escape sequence");
  });

  test("rejects a subject wider than 72 chars", () => {
    const repo = makeRepo();
    const r = runHook(repo, "msg.txt", `${"x".repeat(73)}\n\nbody\n`);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("subject is 73 chars");
  });

  test("accepts a subject at exactly 72 chars", () => {
    const repo = makeRepo();
    const r = runHook(repo, "msg.txt", `${"x".repeat(72)}\n`);
    expect(r.exitCode).toBe(0);
  });
});
