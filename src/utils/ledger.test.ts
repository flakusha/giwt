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
 *   - branch field hygiene: always the resolved branch passed by the
 *     dispatcher, never a subcommand or other positional (doctor check,
 *     sync, abort), and line counts stay one-per-invocation.
 *   - `formatRecord` renders the one-line chat shape.
 *   - `appendCommitOutcome` enriches the invocation line in place (exactly
 *     one ✅ line per commit) and falls back to a supplement line.
 *   - `appendGripe` records the resolved branch with the emoji prefix.
 */

import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  appendCommitOutcome,
  appendGripe,
  appendLedger,
  defaultMessage,
  extractSayArgs,
  finishRecord,
  formatRecord,
  LEDGER_FILENAME,
  LEDGER_MAX_MSG,
  LEDGER_MAX_RECORDS,
  printRecentLedger,
  readLedger,
  truncateMsg,
} from "./ledger";
import {
  type LedgerRecord,
  type LedgerRecordView,
  normalizeRecord,
  parseLedgerTail,
} from "./ledger-core";

/** Fresh ledger tree dir per test. Removed in the file-level afterEach —
 *  even a failed test cannot leak its fixture into /tmp. */
const tempRoots: string[] = [];
afterEach(() => {
  for (const r of tempRoots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function makeTreeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "giwt-ledger-"));
  tempRoots.push(dir);
  return dir;
}

/** Non-empty file lines, for asserting raw line counts. */
function rawLines(dir: string): string[] {
  return readFileSync(join(dir, LEDGER_FILENAME), "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
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
      appendLedger(dir, "new", ["my-branch"], "working on auth", "my-branch");
      const records = readLedger(dir, 10);
      expect(records.length).toBe(1);
      expect(records[0]!.cmd).toBe("new");
      expect(records[0]!.branch).toBe("my-branch");
      expect(records[0]!.msg).toBe("new my-branch :: working on auth");
      // Writers emit v2 via newRecord; first line in an empty file is seq 1.
      expect(records[0]!.v).toBe(2);
      expect(records[0]!.state).toBe("in-progress");
      expect(records[0]!.agent).toBe(process.env.GIWT_AGENT ?? `${hostname()}:${process.pid}`);
      expect(records[0]!.seq).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never creates a missing treeDir as a side effect", () => {
    const dir = join(makeTreeDir(), "no-such-tree");
    appendLedger(dir, "abort", ["--dry-run"], null, "dev");
    expect(existsSync(dir)).toBe(false);
    expect(readLedger(dir, 10)).toEqual([]);
  });

  it("uses the default message when nothing is said", () => {
    const dir = makeTreeDir();
    try {
      appendLedger(dir, "status", [], null, "dev");
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
      appendLedger(dir, "new", ["a"], null, "a");
      writeFileSync(join(dir, LEDGER_FILENAME), "not-json\n", { flag: "a" });
      appendLedger(dir, "new", ["b"], null, "b");
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
        appendLedger(dir, "cmd", [`b${i}`], null, `b${i}`);
      }
      const records = readLedger(dir, LEDGER_MAX_RECORDS + 50);
      expect(records.length).toBe(LEDGER_MAX_RECORDS);
      expect(records[0]!.branch).toBe("b5");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ledger branch field hygiene", () => {
  it("doctor check records the resolved branch, not the 'check' subcommand", () => {
    const dir = makeTreeDir();
    try {
      // Exactly what dispatch does for `giwt doctor check` on master.
      appendLedger(dir, "doctor", ["check"], null, "master");
      const records = readLedger(dir, 10);
      expect(records.length).toBe(1);
      expect(rawLines(dir).length).toBe(1);
      expect(records[0]!.cmd).toBe("doctor");
      expect(records[0]!.branch).toBe("master");
      expect(records[0]!.msg).toBe("doctor check");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sync records the resolved branch despite having no positional arg", () => {
    const dir = makeTreeDir();
    try {
      appendLedger(dir, "sync", ["--fix"], null, "dev");
      const records = readLedger(dir, 10);
      expect(records.length).toBe(1);
      expect(records[0]!.cmd).toBe("sync");
      expect(records[0]!.branch).toBe("dev");
      expect(records[0]!.msg).toBe("sync");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("abort --dry-run records an empty branch when none is resolvable", () => {
    const dir = makeTreeDir();
    try {
      appendLedger(dir, "abort", ["--dry-run"], null, "");
      const records = readLedger(dir, 10);
      expect(records.length).toBe(1);
      expect(records[0]!.branch).toBe("");
      expect(records[0]!.msg).toBe("abort");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("commit-wt appends exactly one line per invocation (outcome enriches, not duplicates)", () => {
    const dir = makeTreeDir();
    try {
      appendLedger(dir, "commit-wt", ["feat-x"], null, "dev");
      appendCommitOutcome(dir, "commit-wt", "dev", "abc1234567890", "fix: x");
      const records = readLedger(dir, 10);
      expect(records.length).toBe(1);
      expect(rawLines(dir).length).toBe(1);
      expect(records[0]!.cmd).toBe("commit-wt");
      expect(records[0]!.branch).toBe("dev");
      expect(records[0]!.msg).toBe("commit-wt feat-x :: ✅ abc123456 fix: x");
      // Enrichment rewrites the invocation line in place: pid preserved.
      expect(records[0]!.pid).toBe(process.pid);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps said-context in the msg when enriching", () => {
    const dir = makeTreeDir();
    try {
      appendLedger(dir, "commit-wt", ["feat-x"], "agent commit", "dev");
      appendCommitOutcome(dir, "commit-wt", "dev", "abc1234567890", "fix: x");
      const records = readLedger(dir, 10);
      expect(records.length).toBe(1);
      expect(records[0]!.msg).toBe("commit-wt feat-x :: agent commit :: ✅ abc123456 fix: x");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a second invocation in the same process gets its own enriched line", () => {
    const dir = makeTreeDir();
    try {
      appendLedger(dir, "commit-wt", ["a"], null, "dev");
      appendCommitOutcome(dir, "commit-wt", "dev", "1111111111111", "one");
      appendLedger(dir, "commit-wt", ["b"], null, "dev");
      appendCommitOutcome(dir, "commit-wt", "dev", "2222222222222", "two");
      const records = readLedger(dir, 10);
      expect(records.length).toBe(2);
      expect(records[0]!.msg).toContain("✅ 111111111 one");
      expect(records[1]!.msg).toBe("commit-wt b :: ✅ 222222222 two");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips foreign-pid lines while hunting for its own invocation line", () => {
    const dir = makeTreeDir();
    try {
      appendLedger(dir, "commit-wt", ["feat-x"], null, "dev");
      // A concurrent writer (other agent/process) lands after our line.
      writeFileSync(
        join(dir, LEDGER_FILENAME),
        JSON.stringify({
          v: 1,
          ts: "2026-09-18T12:00:00Z",
          pid: process.pid + 999999,
          cmd: "commit-wt",
          branch: "other",
          msg: "commit-wt other",
        }) + "\n",
        { flag: "a" },
      );
      appendCommitOutcome(dir, "commit-wt", "dev", "abc1234567890", "fix: x");
      const records = readLedger(dir, 10);
      expect(records.length).toBe(2);
      expect(records[0]!.msg).toBe("commit-wt feat-x :: ✅ abc123456 fix: x");
      expect(records[1]!.msg).toBe("commit-wt other"); // untouched
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("formatRecord", () => {
  it("renders the one-line chat shape", () => {
    expect(formatRecord(
      normalizeRecord({
        v: 1,
        ts: "2026-09-10T06:55:01Z",
        pid: 1234,
        cmd: "new",
        branch: "my-branch",
        msg: "new my-branch",
      })!,
    )).toBe("[09-10 06:55] [#1234] [my-branch] new: new my-branch");
  });

  it("renders missing branch as -", () => {
    expect(formatRecord(
      normalizeRecord({
        v: 1,
        ts: "2026-09-10T06:55:01Z",
        pid: 7,
        cmd: "status",
        branch: "",
        msg: "status",
      })!,
    )).toContain("[-] status: status");
  });

  it("is byte-identical for a fixed v2 record", () => {
    const record: LedgerRecord = {
      v: 2,
      ts: "2026-10-03T09:04:02Z",
      pid: 4242,
      agent: "omp",
      cmd: "finalize",
      branch: "feat-x",
      msg: "finalize feat-x",
      state: "finished",
      seq: 7,
    };
    expect(formatRecord(record)).toBe("[10-03 09:04] [#4242] [feat-x] finalize: finalize feat-x");
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
  it("appends a supplement line when the invocation line is missing", () => {
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

  it("is idempotent when the own line is already enriched", () => {
    const dir = makeTreeDir();
    try {
      appendLedger(dir, "commit", [], null, "dev");
      appendCommitOutcome(dir, "commit", "dev", "abc1234567890", "fix: x");
      // A stray second outcome call must not add a second ✅ line.
      appendCommitOutcome(dir, "commit", "dev", "abc1234567890", "fix: x");
      const records = readLedger(dir, 10);
      expect(records.length).toBe(1);
      expect((rawLines(dir).join("\n").match(/✅/g) ?? []).length).toBe(1);
      expect(records[0]!.msg).toBe("commit :: ✅ abc123456 fix: x");
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

describe("ledger failure and display paths", () => {
  function capture(): { text: () => string; restore: () => void; } {
    const chunks: string[] = [];
    const push = (chunk: unknown): boolean => {
      chunks.push(String(chunk));
      return true;
    };
    const out = spyOn(process.stdout, "write").mockImplementation(push as never);
    const err = spyOn(process.stderr, "write").mockImplementation(push as never);
    return {
      text: () => chunks.join(""),
      restore: () => {
        out.mockRestore();
        err.mockRestore();
      },
    };
  }

  it("printRecentLedger prints the empty placeholder when there is no ledger", () => {
    const dir = makeTreeDir();
    const cap = capture();
    try {
      printRecentLedger(dir);
    } finally {
      cap.restore();
      rmSync(dir, { recursive: true, force: true });
    }
    expect(cap.text()).toContain("Agent ledger is empty — no recent agent activity");
  });

  it("printRecentLedger renders the newest records one line each", () => {
    const dir = makeTreeDir();
    try {
      appendLedger(dir, "new", ["a"], null, "a");
      appendLedger(dir, "sync", [], null, "dev");
      const cap = capture();
      try {
        printRecentLedger(dir, 10);
      } finally {
        cap.restore();
      }
      const out = cap.text();
      expect(out).toContain("Agent ledger (last 2):");
      expect(out).toContain("] new: new a");
      expect(out).toContain("] sync: sync");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("readLedger and appendLedger tolerate a ledger path that is not a file", () => {
    const dir = makeTreeDir();
    try {
      // A directory at the ledger path: existsSync passes, reads/writes throw.
      mkdirSync(join(dir, LEDGER_FILENAME));
      expect(readLedger(dir, 5)).toEqual([]);
      expect(() => appendLedger(dir, "new", ["a"], null, "a")).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("appendCommitOutcome falls back to a supplement line with no matching invocation", () => {
    const dir = makeTreeDir();
    try {
      writeFileSync(
        join(dir, LEDGER_FILENAME),
        JSON.stringify({
          v: 1,
          ts: "2026-09-18T12:00:00Z",
          pid: process.pid + 424242,
          cmd: "commit-wt",
          branch: "other",
          msg: "commit-wt other",
        }) + "\n",
      );
      appendCommitOutcome(dir, "commit-wt", "dev", "abc1234567890", "fix: x");
      const lines = rawLines(dir);
      expect(lines.length).toBe(2);
      expect(lines[1]).toContain("✅ abc123456 fix: x");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("appendCommitOutcome skips corrupt lines while hunting its own record", () => {
    const dir = makeTreeDir();
    try {
      appendLedger(dir, "commit-wt", ["feat"], null, "dev");
      writeFileSync(join(dir, LEDGER_FILENAME), "}{ not json\n", { flag: "a" });
      appendCommitOutcome(dir, "commit-wt", "dev", "feedface0000", "feat: y");
      const records = readLedger(dir, 10);
      const own = records.find((r) => r.pid === process.pid)!;
      expect(own.msg).toBe("commit-wt feat :: ✅ feedface0 feat: y");
      expect(records.length).toBe(1); // corrupt line was skipped, not rewritten into a record
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("appendCommitOutcome never throws on an unreadable ledger path", () => {
    const dir = makeTreeDir();
    try {
      mkdirSync(join(dir, LEDGER_FILENAME));
      expect(() => appendCommitOutcome(dir, "commit-wt", "dev", "abc1234567890", "fix: x"))
        .not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("normalizeRecord", () => {
  it("passes a valid v2 record through unchanged", () => {
    const v2: LedgerRecordView = {
      v: 2,
      ts: "2026-10-03T09:00:00Z",
      pid: 11,
      agent: "omp",
      cmd: "new",
      branch: "b",
      msg: "new b",
      state: "in-progress",
      seq: 3,
      error: { message: "gate failed", code: 1, gates: ["tsc"] },
    };
    expect(normalizeRecord(v2)).toEqual(v2);
  });

  it("normalizes a v1 record to the v2 view", () => {
    expect(normalizeRecord({
      v: 1,
      ts: "2026-09-10T06:55:01Z",
      pid: 1234,
      cmd: "new",
      branch: "my-branch",
      msg: "new my-branch",
    })).toEqual({
      v: 2,
      ts: "2026-09-10T06:55:01Z",
      pid: 1234,
      agent: "pid:1234",
      cmd: "new",
      branch: "my-branch",
      msg: "new my-branch",
      state: "observed",
      seq: 0,
    });
  });

  it("rejects garbage", () => {
    expect(normalizeRecord(null)).toBeNull();
    expect(normalizeRecord("line")).toBeNull();
    expect(normalizeRecord({ v: 3 })).toBeNull();
    expect(normalizeRecord([1, 2])).toBeNull();
  });

  it("rejects records with missing msg or ts", () => {
    expect(normalizeRecord({ v: 1, ts: "2026-09-10T06:55:01Z", pid: 1, cmd: "c", branch: "" }))
      .toBeNull();
    expect(
      normalizeRecord({
        v: 2,
        pid: 1,
        agent: "a",
        cmd: "c",
        branch: "",
        msg: "m",
        state: "finished",
        seq: 0,
      }),
    ).toBeNull();
  });
});

describe("parseLedgerTail", () => {
  const v1Line = (msg: string): string =>
    JSON.stringify({ v: 1, ts: "2026-10-03T09:00:00Z", pid: 1, cmd: "a", branch: "x", msg });

  it("returns only complete lines and resumes at the partial tail", () => {
    const one = v1Line("m1");
    const two = v1Line("m2");
    const text = `${one}\n${two}\n${v1Line("par").slice(0, 12)}`;
    const tail = parseLedgerTail(text, 0);
    expect(tail.records.map((r) => r.msg)).toEqual(["m1", "m2"]);
    expect(tail.offset).toBe(one.length + 1 + two.length + 1);
    // Completing the trailing line and resuming from tail.offset yields only the third record.
    const rest = parseLedgerTail(`${text}${v1Line("par").slice(12)}\n`, tail.offset);
    expect(rest.records.map((r) => r.msg)).toEqual(["par"]);
  });

  it("offset equals text.length when text ends with a newline", () => {
    const line = v1Line("m");
    const text = `${line}\n`;
    expect(parseLedgerTail(text, 0)).toEqual({
      records: [normalizeRecord(JSON.parse(line))!],
      offset: text.length,
    });
  });

  it("fromOffset beyond length returns no records and keeps the offset", () => {
    expect(parseLedgerTail("{}\n", 999)).toEqual({ records: [], offset: 999 });
  });

  it("treats a negative fromOffset as 0 and skips bad lines", () => {
    const tail = parseLedgerTail(`not-json\n${v1Line("m")}\n`, -5);
    expect(tail.records.map((r) => r.msg)).toEqual(["m"]);
  });
});

describe("readLedger mixed-version fixture", () => {
  it("normalizes v1 and v2 lines, newest last", () => {
    const dir = mkdtempSync(join(tmpdir(), "giwt-ledger-core-"));
    try {
      writeFileSync(
        join(dir, LEDGER_FILENAME),
        JSON.stringify({
          v: 1,
          ts: "2026-09-18T12:00:00Z",
          pid: 111,
          cmd: "old",
          branch: "dev",
          msg: "v1 line",
        }) + "\n" + JSON.stringify({
          v: 2,
          ts: "2026-10-03T09:00:00Z",
          pid: 222,
          agent: "omp",
          cmd: "new",
          branch: "feat",
          msg: "v2 line",
          state: "finished",
          seq: 4,
        }) + "\n",
      );
      const records = readLedger(dir, 10);
      expect(records.length).toBe(2);
      expect(records[0]).toEqual({
        v: 2,
        ts: "2026-09-18T12:00:00Z",
        pid: 111,
        agent: "pid:111",
        cmd: "old",
        branch: "dev",
        msg: "v1 line",
        state: "observed",
        seq: 0,
      });
      expect(records[1]).toEqual({
        v: 2,
        ts: "2026-10-03T09:00:00Z",
        pid: 222,
        agent: "omp",
        cmd: "new",
        branch: "feat",
        msg: "v2 line",
        state: "finished",
        seq: 4,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("schema v2 writer", () => {
  it("v2 append after v1 history produces seq 1 and hostname:pid agent", () => {
    const dir = makeTreeDir();
    try {
      writeFileSync(
        join(dir, LEDGER_FILENAME),
        JSON.stringify({
          v: 1,
          ts: "2026-09-18T12:00:00Z",
          pid: 111,
          cmd: "old",
          branch: "dev",
          msg: "v1 line",
        }) + "\n",
      );
      delete process.env.GIWT_AGENT;
      appendLedger(dir, "new", ["b"], null, "b");
      const records = readLedger(dir, 10);
      expect(records.length).toBe(2);
      expect(records[0]!.seq).toBe(0); // v1 history normalizes to seq 0
      expect(records[1]!.seq).toBe(1); // first v2 line is seq 1
      expect(records[1]!.state).toBe("in-progress");
      expect(records[1]!.agent).toBe(`${hostname()}:${process.pid}`);
      // v1 history stays byte-identical on disk.
      expect(JSON.parse(rawLines(dir)[0]!)).toEqual({
        v: 1,
        ts: "2026-09-18T12:00:00Z",
        pid: 111,
        cmd: "old",
        branch: "dev",
        msg: "v1 line",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses $GIWT_AGENT as the agent identity when set", () => {
    const dir = makeTreeDir();
    const prev = process.env.GIWT_AGENT;
    process.env.GIWT_AGENT = "omp";
    try {
      appendLedger(dir, "status", [], null, "dev");
      expect(readLedger(dir, 10)[0]!.agent).toBe("omp");
    } finally {
      if (prev === undefined) delete process.env.GIWT_AGENT;
      else process.env.GIWT_AGENT = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finishRecord enriches only THIS invocation's line (pid + cmd match)", () => {
    const dir = makeTreeDir();
    try {
      appendLedger(dir, "sync", [], null, "dev");
      // Foreign pid, same cmd: must be skipped, not enriched.
      writeFileSync(
        join(dir, LEDGER_FILENAME),
        JSON.stringify({
          v: 2,
          ts: "2026-10-03T09:00:00Z",
          pid: process.pid + 1,
          agent: "other",
          cmd: "sync",
          branch: "dev",
          msg: "sync",
          state: "in-progress",
          seq: 0,
        }) + "\n",
        { flag: "a" },
      );
      expect(finishRecord(dir, "sync", { state: "finished", text: "done" })).toBe("enriched");
      const records = readLedger(dir, 10);
      expect(records[0]!.msg).toBe("sync :: done"); // own line enriched
      expect(records[0]!.state).toBe("finished");
      expect(records[0]!.pid).toBe(process.pid);
      expect(records[1]!.msg).toBe("sync"); // foreign line untouched
      expect(records[1]!.state).toBe("in-progress");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finishRecord returns not-found with no matching line; postponed carries the error object", () => {
    const dir = makeTreeDir();
    try {
      expect(
        finishRecord(dir, "sync", {
          state: "postponed",
          text: "gates pending",
          error: { message: "gate failed", code: 1, gates: ["tsc"] },
        }),
      ).toBe("not-found");
      appendLedger(dir, "sync", [], null, "dev");
      // A different cmd never matches this invocation's sync line.
      expect(finishRecord(dir, "other-cmd", { state: "postponed", text: "x" })).toBe(
        "not-found",
      );
      expect(
        finishRecord(dir, "sync", {
          state: "postponed",
          text: "gates pending",
          error: { message: "gate failed", code: 1, gates: ["tsc"] },
        }),
      ).toBe("enriched");
      const rec = readLedger(dir, 10)[0]!;
      expect(rec.state).toBe("postponed");
      expect(rec.msg).toBe("sync :: gates pending");
      expect(rec.error).toEqual({ message: "gate failed", code: 1, gates: ["tsc"] });
      // Terminal state makes a second finish a no-op.
      expect(finishRecord(dir, "sync", { state: "finished", text: "again" })).toBe(
        "already-done",
      );
      expect(readLedger(dir, 10)[0]!.msg).toBe("sync :: gates pending");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("thin wrappers keep the same records as before for identical inputs", () => {
    const dir = makeTreeDir();
    try {
      // appendCommitOutcome supplement fallback: same msg text as before.
      appendCommitOutcome(dir, "commit", "dev", "abc1234567890", "fix: x");
      const enriched = readLedger(dir, 10)[0]!;
      expect(enriched.msg).toBe("commit dev :: ✅ abc123456 fix: x");
      // appendGripe: same msg text as before.
      appendGripe(dir, "my-branch", "boom");
      const gripe = readLedger(dir, 10)[1]!;
      expect(gripe.msg).toBe("gripe my-branch :: 😤 boom");
      expect(gripe.state).toBe("in-progress");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("appendCommitOutcome enrichment marks the record finished", () => {
    const dir = makeTreeDir();
    try {
      appendLedger(dir, "commit-wt", ["feat-x"], null, "dev");
      appendCommitOutcome(dir, "commit-wt", "dev", "abc1234567890", "fix: x");
      const rec = readLedger(dir, 10)[0]!;
      expect(rec.state).toBe("finished");
      expect(rec.msg).toBe("commit-wt feat-x :: ✅ abc123456 fix: x");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("concurrent writers", () => {
  /** Spawn one bun subprocess that appends (and optionally finishes) its
   *  own ledger record against the shared treeDir. Real concurrency:
   *  separate OS processes racing on one .ledger.jsonl. */
  function spawnWriter(dir: string, finish: boolean) {
    const script = [
      `import { appendLedger, finishRecord } from ${
        JSON.stringify(pathToFileURL(resolve(import.meta.dir, "ledger.ts")).href)
      };`,
      `appendLedger(${JSON.stringify(dir)}, "say", [], "from-" + process.pid, "dev");`,
      finish
        ? `finishRecord(${JSON.stringify(dir)}, "say", { state: "finished", text: "done" });`
        : "",
    ].join("\n");
    return Bun.spawn([process.execPath, "-e", script], {
      stderr: "pipe",
      stdout: "pipe",
    });
  }

  it("parallel CLI appends never lose records; seqs stay unique", async () => {
    const dir = makeTreeDir();
    const procs = Array.from({ length: 8 }, () => spawnWriter(dir, false));
    const codes = await Promise.all(procs.map((p) => p.exited));
    expect(codes).toEqual(Array(8).fill(0));
    const recs = readLedger(dir, 100);
    expect(recs.length).toBe(8);
    const seqs = new Set(recs.map((r) => r.seq));
    expect(seqs.size).toBe(8);
  });

  it("concurrent append + finishRecord do not clobber each other", async () => {
    const dir = makeTreeDir();
    const procs = Array.from({ length: 8 }, () => spawnWriter(dir, true));
    const codes = await Promise.all(procs.map((p) => p.exited));
    expect(codes).toEqual(Array(8).fill(0));
    const recs = readLedger(dir, 100);
    expect(recs.length).toBe(8);
    const seqs = new Set(recs.map((r) => r.seq));
    expect(seqs.size).toBe(8);
    for (const r of recs) {
      expect(r.state).toBe("finished");
      expect(r.msg).toContain(":: done");
    }
  });
});
