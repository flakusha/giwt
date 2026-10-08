// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for `giwt history` (src/commands/history.ts) — command surface:
 * flag parsing, exit codes (gate semantics), --json shape, skips
 * readback, and the comparison mode interpretation. Handlers are driven
 * directly; process.exit is stubbed with the __exit__ sentinel.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type SkipRecord, skipsPath } from "../history/skips";
import { type WorktreeConfig } from "../utils/config";
import { isolatedGitEnv } from "../utils/git";
import { setLogLevel } from "../utils/output";
import { scratchRoot } from "../utils/scratch-tmp";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { history } from "./history";

const temps: string[] = [];

function git(root: string, args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", root, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: isolatedGitEnv(),
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

function commit(root: string, path: string, message: string): void {
  writeFileSync(join(root, path), `${message}\n`);
  git(root, ["add", path]);
  git(root, ["commit", "-qm", message]);
}

function makeRepo(): { root: string; config: WorktreeConfig; } {
  const root = mkdtempSync(join(scratchRoot(), "giwt-history-cmd-"));
  temps.push(root);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "giwt-test@localhost"]);
  git(root, ["config", "user.name", "giwt test"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  commit(root, "base.txt", "base");
  const config: WorktreeConfig = {
    repoRoot: root,
    worktreeRoot: root,
    treeDir: join(root, "tree"),
    settings: { ...DEFAULT_SETTINGS, branches: { ...DEFAULT_SETTINGS.branches, root: "target" } },
  };
  return { root, config };
}

/** Feature branch with a duplicate of target's change + an empty commit. */
function makeSuspicious(root: string): void {
  git(root, ["branch", "target"]);
  git(root, ["checkout", "-q", "target"]);
  commit(root, "shared.txt", "shared change");
  git(root, ["checkout", "-qb", "feature", "main"]);
  writeFileSync(join(root, "shared.txt"), "shared change\n");
  git(root, ["add", "shared.txt"]);
  git(root, ["commit", "-qm", "shared change again"]);
  git(root, ["commit", "-q", "--allow-empty", "-m", "empty marker"]);
  git(root, ["checkout", "-q", "main"]);
}

interface Captured {
  collect: () => string;
  restore: () => void;
}

function capture(): Captured {
  const outSpy = spyOn(process.stdout, "write");
  const errSpy = spyOn(process.stderr, "write");
  outSpy.mockImplementation(() => true);
  errSpy.mockImplementation(() => true);
  return {
    collect: () =>
      [
        ...outSpy.mock.calls.map((args) => String(args[0])),
        ...errSpy.mock.calls.map((args) => String(args[0])),
      ].join(""),
    restore: () => {
      outSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

async function runExpectExit1(runner: () => Promise<void>): Promise<string> {
  const cap = capture();
  const exitSpy = spyOn(process, "exit").mockImplementation(
    ((code?: number) => {
      throw new Error(`__exit__:${code}`);
    }) as typeof process.exit,
  );
  try {
    let aborted = false;
    try {
      await runner();
    } catch (err) {
      expect((err as Error).message).toBe("__exit__:1");
      aborted = true;
    }
    expect(aborted).toBe(true);
    return cap.collect();
  } finally {
    exitSpy.mockRestore();
    cap.restore();
  }
}

beforeEach(() => {
  setLogLevel("info");
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = 0;
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("history audit (command)", () => {
  test("clean range: human output, exit 0", async () => {
    const { root, config } = makeRepo();
    git(root, ["branch", "target"]);
    git(root, ["checkout", "-qb", "feature", "main"]);
    commit(root, "feat.txt", "fresh work");
    git(root, ["checkout", "-q", "main"]);

    const cap = capture();
    try {
      await history(["audit", "feature"], config);
      const out = cap.collect();
      expect(out).toContain("History audit: feature vs target");
      expect(out).toContain("Shape: linear");
      expect(out).toContain("Suspicious commits: none");
      expect(process.exitCode).toBe(0);
    } finally {
      cap.restore();
    }
  });

  test("suspicious range: grouped findings, exit 1 (gate)", async () => {
    const { root, config } = makeRepo();
    makeSuspicious(root);

    const cap = capture();
    try {
      await history(["audit", "feature"], config);
      const out = cap.collect();
      expect(out).toContain("duplicate-patch-id (1)");
      expect(out).toContain("empty-commit (1)");
      expect(out).toContain("shared change again");
      expect(out).toContain("twin");
      expect(process.exitCode).toBe(1);
    } finally {
      cap.restore();
    }
  });

  test("human output prints the explicit truncation notice when capped", async () => {
    const { root, config } = makeRepo();
    git(root, ["branch", "target"]);
    git(root, ["checkout", "-qb", "feature", "main"]);
    for (let i = 1; i <= 3; i++) git(root, ["commit", "-q", "--allow-empty", "-m", `empty ${i}`]);
    git(root, ["checkout", "-q", "main"]);
    const capped = {
      ...config,
      settings: { ...config.settings, audit: { ...DEFAULT_SETTINGS.audit, maxFindings: 2 } },
    };

    const cap = capture();
    try {
      await history(["audit", "feature"], capped);
      expect(cap.collect()).toContain("1 more findings not shown (raise [audit] max_findings)");
    } finally {
      cap.restore();
    }
  });

  test("--onto=<ref> equals-form is accepted", async () => {
    const { root, config } = makeRepo();
    git(root, ["branch", "target"]);
    git(root, ["checkout", "-qb", "feature", "main"]);
    commit(root, "feat.txt", "fresh work");
    git(root, ["checkout", "-q", "main"]);

    const cap = capture();
    try {
      await history(["audit", "feature", "--onto=target"], config);
      expect(cap.collect()).toContain("History audit: feature vs target");
      expect(process.exitCode).toBe(0);
    } finally {
      cap.restore();
    }
  });

  test("--onto without a value refuses", async () => {
    const { config } = makeRepo();
    const out = await runExpectExit1(() => history(["audit", "feature", "--onto"], config));
    expect(out).toContain("--onto requires a ref");
  });

  test("a second positional refuses as unexpected", async () => {
    const { config } = makeRepo();
    const out = await runExpectExit1(() => history(["audit", "feature", "extra"], config));
    expect(out).toContain("unexpected argument 'extra'");
  });

  test("audits the current branch when no positional is given; detached HEAD refuses", async () => {
    const { root, config } = makeRepo();
    git(root, ["branch", "target"]);
    git(root, ["checkout", "-qb", "feature", "main"]);
    commit(root, "feat.txt", "fresh work");

    const cap = capture();
    try {
      await history(["audit"], config);
      expect(cap.collect()).toContain("History audit: feature vs target");
    } finally {
      cap.restore();
    }

    git(root, ["checkout", "-q", "--detach", "main"]);
    const out = await runExpectExit1(() => history(["audit"], config));
    expect(out).toContain("no branch given and HEAD is detached");
    git(root, ["checkout", "-q", "feature"]);
  });

  test("--emoji renders one line per report via the mapper", async () => {
    const { root, config } = makeRepo();
    makeSuspicious(root);

    const outSpy = spyOn(process.stdout, "write");
    outSpy.mockImplementation(() => true);
    try {
      await history(["audit", "feature", "--emoji"], config);
      const line = outSpy.mock.calls.map((a) => String(a[0])).join("").trim();
      expect(line).toContain("⚠️ target..feature: 2 finding(s)");
    } finally {
      outSpy.mockRestore();
    }
  });

  test("--json mirrors runs --json conventions: single raw document, findings grouped", async () => {
    const { root, config } = makeRepo();
    makeSuspicious(root);

    const outSpy = spyOn(process.stdout, "write");
    outSpy.mockImplementation(() => true);
    try {
      await history(["audit", "feature", "--json"], config);
      const payload = outSpy.mock.calls.map((args) => String(args[0])).join("");
      const report = JSON.parse(payload) as {
        v: number;
        shape: { linear: boolean; verdict: string; };
        findings: Record<string, Array<{ sha: string; twins?: string[]; }>>;
        exit: number;
      };
      expect(report.v).toBe(1);
      expect(report.shape.linear).toBe(true);
      expect(report.findings["duplicate-patch-id"]).toHaveLength(1);
      expect(report.findings["duplicate-patch-id"]![0]!.twins).toHaveLength(1);
      expect(report.findings["empty-commit"]).toHaveLength(1);
      expect(report.exit).toBe(1);
      expect(process.exitCode).toBe(1);
    } finally {
      outSpy.mockRestore();
    }
  });

  test("--json carries findingsTotal only when the cap truncated", async () => {
    const { root, config } = makeRepo();
    git(root, ["branch", "target"]);
    git(root, ["checkout", "-qb", "feature", "main"]);
    for (let i = 1; i <= 3; i++) git(root, ["commit", "-q", "--allow-empty", "-m", `empty ${i}`]);
    git(root, ["checkout", "-q", "main"]);
    const capped = {
      ...config,
      settings: { ...config.settings, audit: { ...DEFAULT_SETTINGS.audit, maxFindings: 2 } },
    };

    const outSpy = spyOn(process.stdout, "write");
    outSpy.mockImplementation(() => true);
    try {
      await history(["audit", "feature", "--json"], capped);
      const report = JSON.parse(outSpy.mock.calls.map((a) => String(a[0])).join("")) as {
        findings: Record<string, unknown[]>;
        findingsTotal?: number;
      };
      expect(report.findings["empty-commit"]).toHaveLength(2);
      expect(report.findingsTotal).toBe(3);
    } finally {
      outSpy.mockRestore();
    }
  });

  test("unknown flag refuses with the usage lines", async () => {
    const { config } = makeRepo();
    const out = await runExpectExit1(() => history(["audit", "feature", "--bogus"], config));
    expect(out).toContain("unknown flag '--bogus'");
    expect(out).toContain("Usage: giwt history audit");
  });

  test("unknown subcommand refuses", async () => {
    const { config } = makeRepo();
    const out = await runExpectExit1(() => history(["frobnicate"], config));
    expect(out).toContain("unknown subcommand 'frobnicate'");
  });
});

describe("history skips (command)", () => {
  function plantLedger(config: WorktreeConfig, records: SkipRecord[]): void {
    const path = skipsPath(config);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }

  function plantedRecord(overrides: Partial<SkipRecord> = {}): SkipRecord {
    return {
      v: 1,
      ts: "2026-10-08T01:00:00.000Z",
      branch: "feature",
      onto: "target",
      preHead: "0".repeat(40),
      sha: "1".repeat(40),
      subject: "skipped work",
      patchId: null,
      reason: { detected: "empty" },
      ...overrides,
    };
  }

  test("lists ledger records in replay order; missing ledger reads empty", async () => {
    const { root, config } = makeRepo();
    // A real empty commit so the default --vs comparison stays honest.
    git(root, ["checkout", "-qb", "feature", "main"]);
    git(root, ["commit", "-q", "--allow-empty", "-m", "first empty"]);
    git(root, ["commit", "-q", "--allow-empty", "-m", "second empty"]);
    const shas = git(root, ["rev-list", "--reverse", "main..feature"]).trim().split("\n");
    git(root, ["checkout", "-q", "main"]);
    plantLedger(config, [
      plantedRecord({ sha: shas[0]!, subject: "first empty" }),
      plantedRecord({
        sha: shas[1]!,
        subject: "second empty",
        reason: { detected: "empty", note: "operator ok" },
      }),
    ]);

    const cap = capture();
    try {
      await history(["skips"], config);
      const out = cap.collect();
      expect(out).toContain("2 record(s)");
      expect(out.indexOf("first empty")).toBeLessThan(out.indexOf("second empty"));
      expect(out).toContain("operator ok");
      expect(process.exitCode).toBe(0);
    } finally {
      cap.restore();
    }

    const outSpy = spyOn(process.stdout, "write");
    outSpy.mockImplementation(() => true);
    try {
      process.exitCode = 0;
      await history(["skips", "--emoji"], config);
      const lines = outSpy.mock.calls.map((a) => String(a[0])).join("");
      expect(lines).toContain("first empty");
      expect(lines).toContain("second empty");
    } finally {
      outSpy.mockRestore();
    }
  });

  test("--json emits the record array", async () => {
    const { config } = makeRepo();
    plantLedger(config, [
      plantedRecord({ subject: "only skip" }),
    ]);
    const outSpy = spyOn(process.stdout, "write");
    outSpy.mockImplementation(() => true);
    try {
      await history(["skips", "--json"], config);
      const records = JSON.parse(
        outSpy.mock.calls.map((a) => String(a[0])).join(""),
      ) as SkipRecord[];
      expect(records).toHaveLength(1);
      expect(records[0]!.subject).toBe("only skip");
      expect(records[0]!.reason.detected).toBe("empty");
    } finally {
      outSpy.mockRestore();
    }
  });

  test("--vs passes a verified duplicate and exits 0", async () => {
    const { root, config } = makeRepo();
    git(root, ["branch", "target"]);
    git(root, ["checkout", "-q", "target"]);
    commit(root, "shared.txt", "shared change");
    git(root, ["checkout", "-qb", "feature", "main"]);
    writeFileSync(join(root, "shared.txt"), "shared change\n");
    git(root, ["add", "shared.txt"]);
    git(root, ["commit", "-qm", "shared change again"]);
    const dup = git(root, ["rev-list", "--reverse", "-n", "1", "main..feature"]).trim();
    git(root, ["checkout", "-q", "main"]);
    // The real patch-id of the dropped commit, from its pre-rebase sha.
    const pid = Bun.spawnSync(
      ["git", "-C", root, "show", dup, "--format=", "-p"],
      { stdout: "pipe", stderr: "pipe", env: isolatedGitEnv() },
    );
    const pidOut = Bun.spawnSync(
      ["git", "-C", root, "patch-id", "--stable"],
      {
        stdin: new TextEncoder().encode(pid.stdout.toString()),
        stdout: "pipe",
        stderr: "pipe",
        env: isolatedGitEnv(),
      },
    );
    const patchId = pidOut.stdout.toString().trim().split(/\s+/)[0]!;
    plantLedger(config, [
      plantedRecord({
        sha: dup,
        patchId,
        subject: "shared change again",
        reason: { detected: "duplicate" },
      }),
    ]);

    const cap = capture();
    try {
      await history(["skips", "--vs", "target"], config);
      expect(cap.collect()).toContain("justified");
      expect(process.exitCode).toBe(0);
    } finally {
      cap.restore();
    }
  });

  test("--vs flags a planted non-duplicate as probable real-work loss and exits 1", async () => {
    const { root, config } = makeRepo();
    // A real feature commit whose change is NOT in main — a planted skip
    // claiming it was a duplicate must fail verification.
    git(root, ["checkout", "-qb", "feature", "main"]);
    commit(root, "feature.txt", "feature work");
    const sha = git(root, ["rev-list", "--reverse", "-n", "1", "main..feature"]).trim();
    const pid = Bun.spawnSync(
      ["git", "-C", root, "show", sha, "--format=", "-p"],
      { stdout: "pipe", stderr: "pipe", env: isolatedGitEnv() },
    );
    const pidOut = Bun.spawnSync(
      ["git", "-C", root, "patch-id", "--stable"],
      {
        stdin: new TextEncoder().encode(pid.stdout.toString()),
        stdout: "pipe",
        stderr: "pipe",
        env: isolatedGitEnv(),
      },
    );
    const patchId = pidOut.stdout.toString().trim().split(/\s+/)[0]!;
    git(root, ["checkout", "-q", "main"]);
    plantLedger(config, [
      plantedRecord({ sha, patchId, subject: "feature work", reason: { detected: "duplicate" } }),
    ]);

    const cap = capture();
    try {
      await history(["skips", "--vs", "main"], config);
      const out = cap.collect();
      expect(out).toContain("probable real-work loss");
      expect(out).toContain("1 of 1");
      expect(process.exitCode).toBe(1);
    } finally {
      cap.restore();
    }
  });

  test("--vs=<ref> equals-form works; --json/--emoji comparison records carry the verdict", async () => {
    const { root, config } = makeRepo();
    // A real empty commit (justified) + a planted non-duplicate (flagged).
    git(root, ["branch", "target"]);
    git(root, ["checkout", "-qb", "feature", "main"]);
    git(root, ["commit", "-q", "--allow-empty", "-m", "empty marker"]);
    const emptySha = git(root, ["rev-list", "-n", "1", "HEAD"]).trim();
    commit(root, "feature.txt", "feature work");
    const realSha = git(root, ["rev-list", "-n", "1", "HEAD"]).trim();
    const pid = Bun.spawnSync(
      ["git", "-C", root, "show", realSha, "--format=", "-p"],
      { stdout: "pipe", stderr: "pipe", env: isolatedGitEnv() },
    );
    const pidOut = Bun.spawnSync(
      ["git", "-C", root, "patch-id", "--stable"],
      {
        stdin: new TextEncoder().encode(pid.stdout.toString()),
        stdout: "pipe",
        stderr: "pipe",
        env: isolatedGitEnv(),
      },
    );
    const patchId = pidOut.stdout.toString().trim().split(/\s+/)[0]!;
    git(root, ["checkout", "-q", "main"]);
    plantLedger(config, [
      plantedRecord({
        sha: emptySha,
        patchId: null,
        subject: "empty marker",
        reason: { detected: "empty" },
      }),
      plantedRecord({
        sha: realSha,
        patchId,
        subject: "feature work",
        reason: { detected: "duplicate" },
      }),
    ]);

    const outSpy = spyOn(process.stdout, "write");
    outSpy.mockImplementation(() => true);
    try {
      await history(["skips", "--vs=main", "--json"], config);
      const verdicts = JSON.parse(outSpy.mock.calls.map((a) => String(a[0])).join("")) as Array<
        { subject: string; justified: boolean; twin?: string; problem?: string; }
      >;
      expect(verdicts).toHaveLength(2);
      expect(verdicts[0]!.subject).toBe("empty marker");
      expect(verdicts[0]!.justified).toBe(true);
      expect(verdicts[1]!.subject).toBe("feature work");
      expect(verdicts[1]!.justified).toBe(false);
      expect(verdicts[1]!.problem).toContain("probable real-work loss");
      expect(process.exitCode).toBe(1);
    } finally {
      outSpy.mockRestore();
    }

    const outSpy2 = spyOn(process.stdout, "write");
    outSpy2.mockImplementation(() => true);
    try {
      process.exitCode = 0;
      await history(["skips", "--vs=main", "--emoji"], config);
      const lines = outSpy2.mock.calls.map((a) => String(a[0])).join("");
      expect(lines).toContain("✅");
      expect(lines).toContain("🚨");
      expect(process.exitCode).toBe(1);
    } finally {
      outSpy2.mockRestore();
    }
  });

  test("skips unknown flag and --vs without a value refuse with the usage lines", async () => {
    const { config } = makeRepo();
    const out = await runExpectExit1(() => history(["skips", "--vs"], config));
    expect(out).toContain("--vs requires a ref");
    const out2 = await runExpectExit1(() => history(["skips", "--bogus"], config));
    expect(out2).toContain("unknown flag '--bogus'");
  });

  test("no subcommand refuses with the usage lines", async () => {
    const { config } = makeRepo();
    const out = await runExpectExit1(() => history([], config));
    expect(out).toContain("a subcommand is required");
    expect(out).toContain("Usage: giwt history audit");
  });
});

describe("history audit rename-insensitive fingerprint detector", () => {
  test("flags a replayed commit whose rename-normalized fingerprint matches target", async () => {
    const { root, config } = makeRepo();
    // Target: A adds file.txt with content "hello"
    writeFileSync(join(root, "file.txt"), "hello\n");
    git(root, ["add", "file.txt"]);
    git(root, ["commit", "-qm", "add file.txt"]);
    git(root, ["branch", "target"]);
    git(root, ["checkout", "-q", "target"]);
    // Feature: B adds other.txt with same content (different path, same blob)
    git(root, ["checkout", "-qb", "feature", "main"]);
    writeFileSync(join(root, "other.txt"), "hello\n");
    git(root, ["add", "other.txt"]);
    git(root, ["commit", "-qm", "add other.txt"]);
    git(root, ["checkout", "-q", "main"]);

    const cap = capture();
    try {
      await history(["audit", "feature"], config);
      const out = cap.collect();
      expect(out).toContain("duplicate-rename-insensitive");
      expect(out).toContain("add other.txt");
      expect(process.exitCode).toBe(1);
    } finally {
      cap.restore();
    }
  });

  test("--json includes duplicate-rename-insensitive findings", async () => {
    const { root, config } = makeRepo();
    writeFileSync(join(root, "file.txt"), "hello\n");
    git(root, ["add", "file.txt"]);
    git(root, ["commit", "-qm", "add file.txt"]);
    git(root, ["branch", "target"]);
    git(root, ["checkout", "-q", "target"]);
    git(root, ["checkout", "-qb", "feature", "main"]);
    writeFileSync(join(root, "other.txt"), "hello\n");
    git(root, ["add", "other.txt"]);
    git(root, ["commit", "-qm", "add other.txt"]);
    git(root, ["checkout", "-q", "main"]);

    const outSpy = spyOn(process.stdout, "write");
    outSpy.mockImplementation(() => true);
    try {
      await history(["audit", "feature", "--json"], config);
      const report = JSON.parse(outSpy.mock.calls.map((a) => String(a[0])).join("")) as {
        findings: Record<string, Array<{ sha: string; twins?: string[]; }>>;
        exit: number;
      };
      expect(report.findings["duplicate-rename-insensitive"]).toHaveLength(1);
      expect(report.findings["duplicate-rename-insensitive"]![0]!.twins).toHaveLength(1);
      expect(report.exit).toBe(1);
    } finally {
      outSpy.mockRestore();
    }
  });

  test("does not flag when patch-ids differ and fingerprints differ", async () => {
    const { root, config } = makeRepo();
    writeFileSync(join(root, "file.txt"), "hello\n");
    git(root, ["add", "file.txt"]);
    git(root, ["commit", "-qm", "add file.txt"]);
    git(root, ["branch", "target"]);
    git(root, ["checkout", "-q", "target"]);
    git(root, ["checkout", "-qb", "feature", "main"]);
    writeFileSync(join(root, "other.txt"), "world\n");
    git(root, ["add", "other.txt"]);
    git(root, ["commit", "-qm", "add other.txt"]);
    git(root, ["checkout", "-q", "main"]);

    const cap = capture();
    try {
      await history(["audit", "feature"], config);
      const out = cap.collect();
      expect(out).not.toContain("duplicate-rename-insensitive");
      expect(process.exitCode).toBe(0);
    } finally {
      cap.restore();
    }
  });
});

describe("history resurrected (command)", () => {
  test("exits 1 on number-collision fixture", async () => {
    const { root, config } = makeRepo();
    mkdirSync(join(root, "migrations"), { recursive: true });
    writeFileSync(
      join(root, "migrations", "040_messages_idempotency_unique.ts"),
      "export const x = 1;\n",
    );
    writeFileSync(join(root, "migrations", "040_other_name.ts"), "export const y = 2;\n");
    git(root, ["add", "migrations"]);
    git(root, ["commit", "-qm", "add migrations"]);

    const cap = capture();
    try {
      await history(["resurrected", "migrations"], config);
      const out = cap.collect();
      expect(out).toContain("number-collision");
      expect(out).toContain("040_messages_idempotency_unique.ts");
      expect(out).toContain("040_other_name.ts");
      expect(process.exitCode).toBe(1);
    } finally {
      cap.restore();
    }
  });

  test("exits 0 on a clean directory", async () => {
    const { root, config } = makeRepo();
    mkdirSync(join(root, "clean"), { recursive: true });
    writeFileSync(join(root, "clean", "001_first.ts"), "export const a = 1;\n");
    writeFileSync(join(root, "clean", "002_second.ts"), "export const b = 2;\n");
    git(root, ["add", "clean"]);
    git(root, ["commit", "-qm", "add clean"]);

    const cap = capture();
    try {
      await history(["resurrected", "clean"], config);
      const out = cap.collect();
      expect(out).toContain("No resurrected files found");
      expect(process.exitCode).toBe(0);
    } finally {
      cap.restore();
    }
  });

  test("refuses when no directory is given", async () => {
    const { config } = makeRepo();
    const out = await runExpectExit1(() => history(["resurrected"], config));
    expect(out).toContain("resurrected requires at least one directory");
  });

  test("--json outputs findings array", async () => {
    const { root, config } = makeRepo();
    mkdirSync(join(root, "migrations"), { recursive: true });
    writeFileSync(join(root, "migrations", "040_a.ts"), "export const x = 1;\n");
    writeFileSync(join(root, "migrations", "040_b.ts"), "export const y = 2;\n");
    git(root, ["add", "migrations"]);
    git(root, ["commit", "-qm", "add migrations"]);

    const outSpy = spyOn(process.stdout, "write");
    outSpy.mockImplementation(() => true);
    try {
      await history(["resurrected", "migrations", "--json"], config);
      const payload = outSpy.mock.calls.map((a) => String(a[0])).join("");
      const findings = JSON.parse(payload) as Array<
        { detector: string; reason: string; paths: string[]; }
      >;
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0]!.detector).toBe("resurrected");
      expect(findings[0]!.reason).toBe("number-collision");
    } finally {
      outSpy.mockRestore();
    }
  });
});

describe("history weave (command)", () => {
  test("flags a triplicated-line file, exits 1", async () => {
    const { root, config } = makeRepo();
    const triplicated = [
      "function build() {",
      "  const callback = (e) => e.target;",
      "  const callback = (e) => e.target;",
      "  const callback = (e) => e.target;",
      "  return callback;",
      "}",
    ].join("\n");
    writeFileSync(join(root, "ui.ts"), triplicated);

    const cap = capture();
    try {
      await history(["weave", "ui.ts"], config);
      const out = cap.collect();
      expect(out).toContain("repeated-lines");
      expect(out).toContain("ui.ts");
      expect(process.exitCode).toBe(1);
    } finally {
      cap.restore();
    }
  });

  test("exits 0 on a normal file", async () => {
    const { root, config } = makeRepo();
    const normal = [
      "function build() {",
      "  const callback = (e) => e.target;",
      "  return callback;",
      "}",
    ].join("\n");
    writeFileSync(join(root, "clean.ts"), normal);

    const cap = capture();
    try {
      await history(["weave", "clean.ts"], config);
      const out = cap.collect();
      expect(out).toContain("No weave damage found");
      expect(process.exitCode).toBe(0);
    } finally {
      cap.restore();
    }
  });

  test("refuses when no file is given", async () => {
    const { config } = makeRepo();
    const out = await runExpectExit1(() => history(["weave"], config));
    expect(out).toContain("weave requires at least one file");
  });

  test("--json outputs findings array", async () => {
    const { root, config } = makeRepo();
    const triplicated = [
      "function build() {",
      "  const callback = (e) => e.target;",
      "  const callback = (e) => e.target;",
      "  const callback = (e) => e.target;",
      "  return callback;",
      "}",
    ].join("\n");
    writeFileSync(join(root, "ui.ts"), triplicated);

    const outSpy = spyOn(process.stdout, "write");
    outSpy.mockImplementation(() => true);
    try {
      await history(["weave", "ui.ts", "--json"], config);
      const payload = outSpy.mock.calls.map((a) => String(a[0])).join("");
      const findings = JSON.parse(payload) as Array<
        { detector: string; reason: string; paths: string[]; }
      >;
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0]!.detector).toBe("weave");
      expect(findings[0]!.reason).toBe("repeated-lines");
    } finally {
      outSpy.mockRestore();
    }
  });

  test("--baseline flag is accepted", async () => {
    const { root, config } = makeRepo();
    const normal = [
      "function build() {",
      "  const callback = (e) => e.target;",
      "  return callback;",
      "}",
    ].join("\n");
    writeFileSync(join(root, "clean.ts"), normal);
    git(root, ["add", "clean.ts"]);
    git(root, ["commit", "-qm", "add clean.ts"]);

    const cap = capture();
    try {
      await history(["weave", "clean.ts", "--baseline", "HEAD"], config);
      expect(process.exitCode).toBe(0);
    } finally {
      cap.restore();
    }
  });
});
