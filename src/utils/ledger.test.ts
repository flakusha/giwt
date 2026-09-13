// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the agent ledger (`utils/ledger.ts`).
 *
 * Coverage:
 *   - `extractSayArgs` strips --say/--ledger-msg (space + equals forms),
 *     leaves other flags (incl. -m/-F) untouched.
 *   - `defaultMessage` prefers the first positional arg.
 *   - `truncateMsg` collapses whitespace and caps at LEDGER_MAX_MSG.
 *   - `appendLedger`/`readLedger` roundtrip; `readLedger` caps `last`,
 *     skips corrupt lines, returns [] when missing.
 *   - append prunes to LEDGER_MAX_RECORDS and embeds --say context.
 *   - `formatRecord` renders the one-line chat shape.
 *   - `appendCommitOutcome` records short SHA + subject for commit cmds.
 */

import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendCommitOutcome,
  appendGripe,
  appendLedger,
  defaultMessage,
  extractSayArgs,
  formatRecord,
  LEDGER_FILENAME,
  LEDGER_MAX_MSG,
  LEDGER_MAX_RECORDS,
  readLedger,
  truncateMsg,
} from "./ledger";

function makeTreeDir(): string {
  return mkdtempSync(join(tmpdir(), "giwt-ledger-"));
}

describe("extractSayArgs", () => {
  it("strips --say and keeps the rest", () => {
    const r = extractSayArgs(["new", "my-branch", "--say", "working on auth"]);
    expect(r.cleanArgs).toEqual(["new", "my-branch"]);
    expect(r.said).toBe("working on auth");
  });

  it("strips --ledger-msg and --say= forms", () => {
    expect(extractSayArgs(["--ledger-msg", "ctx", "finalize", "b"]).said).toBe("ctx");
    expect(extractSayArgs(["finalize", "b", "--say=ctx here"]).said).toBe("ctx here");
    expect(extractSayArgs(["--ledger-msg=ctx"]).cleanArgs).toEqual([]);
  });

  it("leaves -m/-F and other flags alone", () => {
    const r = extractSayArgs(["commit-wt", "b", "-m", "fix: x", "--force"]);
    expect(r.cleanArgs).toEqual(["commit-wt", "b", "-m", "fix: x", "--force"]);
    expect(r.said).toBeNull();
  });

  it("yields said=null when no say flag", () => {
    expect(extractSayArgs(["status"])).toEqual({ cleanArgs: ["status"], said: null });
  });
});

describe("defaultMessage", () => {
  it("combines cmd with first positional", () => {
    expect(defaultMessage("finalize", ["my-branch", "--force"])).toBe("finalize my-branch");
  });

  it("falls back to bare cmd", () => {
    expect(defaultMessage("ledger", ["--json"])).toBe("ledger");
  });
});

describe("truncateMsg", () => {
  it("collapses whitespace", () => {
    expect(truncateMsg("  a\n\t b  c ")).toBe("a b c");
  });

  it("caps long messages with an ellipsis", () => {
    const r = truncateMsg("x".repeat(LEDGER_MAX_MSG + 50));
    expect(r.length).toBe(LEDGER_MAX_MSG);
    expect(r.endsWith("…")).toBe(true);
  });
});

describe("appendLedger/readLedger", () => {
  it("roundtrips a record with --say context", () => {
    const dir = makeTreeDir();
    try {
      appendLedger(dir, "new", ["my-branch"], "working on auth");
      const records = readLedger(dir, 10);
      expect(records.length).toBe(1);
      expect(records[0]!.cmd).toBe("new");
      expect(records[0]!.branch).toBe("my-branch");
      expect(records[0]!.msg).toBe("new my-branch :: working on auth");
      expect(records[0]!.v).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never creates a missing treeDir as a side effect", () => {
    const dir = join(makeTreeDir(), "no-such-tree");
    appendLedger(dir, "abort", ["--dry-run"], null);
    expect(existsSync(dir)).toBe(false);
    expect(readLedger(dir, 10)).toEqual([]);
  });

  it("uses the default message when nothing is said", () => {
    const dir = makeTreeDir();
    try {
      appendLedger(dir, "status", [], null);
      expect(readLedger(dir, 10)[0]!.msg).toBe("status");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns [] for a missing ledger", () => {
    expect(readLedger(makeTreeDir(), 10)).toEqual([]);
  });

  it("skips corrupt lines", () => {
    const dir = makeTreeDir();
    try {
      appendLedger(dir, "new", ["a"], null);
      writeFileSync(join(dir, LEDGER_FILENAME), "not-json\n", { flag: "a" });
      appendLedger(dir, "new", ["b"], null);
      const records = readLedger(dir, 10);
      expect(records.map((r) => r.branch)).toEqual(["a", "b"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prunes to LEDGER_MAX_RECORDS", () => {
    const dir = makeTreeDir();
    try {
      for (let i = 0; i < LEDGER_MAX_RECORDS + 5; i++) {
        appendLedger(dir, "cmd", [`b${i}`], null);
      }
      const records = readLedger(dir, LEDGER_MAX_RECORDS + 50);
      expect(records.length).toBe(LEDGER_MAX_RECORDS);
      expect(records[0]!.branch).toBe("b5");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("formatRecord", () => {
  it("renders the one-line chat shape", () => {
    expect(formatRecord({
      v: 1,
      ts: "2026-09-10T06:55:01Z",
      pid: 1234,
      cmd: "new",
      branch: "my-branch",
      msg: "new my-branch",
    })).toBe("[09-10 06:55] [#1234] [my-branch] new: new my-branch");
  });

  it("renders missing branch as -", () => {
    expect(formatRecord({
      v: 1,
      ts: "2026-09-10T06:55:01Z",
      pid: 7,
      cmd: "status",
      branch: "",
      msg: "status",
    })).toContain("[-] status: status");
  });
});
describe("appendGripe", () => {
  it("writes a gripe record with the emoji prefix", () => {
    const dir = makeTreeDir();
    try {
      appendGripe(dir, "my-branch", "finalize my-branch failed (exit 1) — see console output");
      const records = readLedger(dir, 10);
      expect(records.length).toBe(1);
      expect(records[0]!.cmd).toBe("gripe");
      expect(records[0]!.branch).toBe("my-branch");
      expect(records[0]!.msg).toBe(
        "gripe my-branch :: 😤 finalize my-branch failed (exit 1) — see console output",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tolerates an unknown branch", () => {
    const dir = makeTreeDir();
    try {
      appendGripe(dir, "", "boom");
      const records = readLedger(dir, 10);
      expect(records[0]!.branch).toBe("");
      expect(records[0]!.msg).toBe("gripe :: 😤 boom");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
describe("appendCommitOutcome", () => {
  it("writes a commit record with short SHA and subject", () => {
    const dir = makeTreeDir();
    try {
      appendCommitOutcome(
        dir,
        "commit-wt",
        "my-branch",
        "abc1234567890",
        "fix(worktree): handle empty stdin\n\nBody here",
      );
      const records = readLedger(dir, 10);
      expect(records.length).toBe(1);
      expect(records[0]!.cmd).toBe("commit-wt");
      expect(records[0]!.branch).toBe("my-branch");
      expect(records[0]!.msg).toBe(
        "commit-wt my-branch :: ✅ abc123456 fix(worktree): handle empty stdin",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tolerates an unknown branch", () => {
    const dir = makeTreeDir();
    try {
      appendCommitOutcome(dir, "commit", "", "abc1234567890", "fix: x");
      const records = readLedger(dir, 10);
      expect(records[0]!.branch).toBe("");
      expect(records[0]!.msg).toBe("commit :: ✅ abc123456 fix: x");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
