// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Real-tar fixture: a small tree driven through dump → verify with real GNU
 * tar/zstd/sqlite3 spawns. Deterministic: fixed file contents, stamp-collision
 * safety via name selection, no wall-clock timing assertions.
 *
 * RESOURCE CONTRACT (parallel safety):
 * - Every test owns a PRIVATE root created by makeFixture via mkdtempSync
 *   under the repo's gitignored .tmp/ — never a fixed shared path, so two
 *   suites (or two concurrent runs) can never contend on the same lock dir,
 *   .snar chain, or staging area.
 * - All sub-paths (backups root, scratch staging, lock dir) derive from that
 *   private root; no test depends on a previous test's leftovers (the
 *   lock-refusal test acquires its own held lock).
 * - Roots are registered in tempRoots at creation and removed in a file-level
 *   afterEach (rmSync recursive+force), so even a failed test cannot leak.
 * - Child spawns are bounded (per-test timeouts; the annex test widens its own).
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { backup } from "../commands/backup";
import type { WorktreeConfig } from "../utils/config";
import { DEFAULT_SETTINGS, type GiwtSettings } from "../utils/settings";
import { type DumpOptions, previewDump, runDump } from "./dump";
import { acquireBackupLock } from "./lock";
import { utcStamp } from "./plan";
import { quiesceTarget } from "./quiesce";
import { removeScratchTree, verifyRoot } from "./verify";

/** Private fixture roots created this file; afterEach guarantees removal. */
const tempRoots: string[] = [];
const HAS_SQLITE = Bun.which("sqlite3") !== null;

interface Fixture {
  repo: string;
  root: string;
  scratch: string;
}

function makeFixture(name: string): Fixture {
  mkdirSync(join(process.cwd(), ".tmp"), { recursive: true });
  const repo = mkdtempSync(join(process.cwd(), ".tmp", `giwt-dump-${name}-`));
  tempRoots.push(repo);
  const docs = join(repo, "docs");
  const data = join(repo, "data");
  mkdirSync(docs, { recursive: true });
  mkdirSync(data, { recursive: true });
  writeFileSync(join(docs, "a.txt"), "alpha\n");
  if (HAS_SQLITE) {
    const created = Bun.spawnSync(
      ["sqlite3", join(data, "store.db"), "CREATE TABLE t(x); INSERT INTO t VALUES (42);"],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (created.exitCode !== 0) throw new Error("fixture sqlite3 setup failed");
  } else {
    writeFileSync(join(data, "store.db"), "not a real db — sqlite3 absent");
  }
  return { repo, root: join(repo, "backups"), scratch: join(repo, ".tmp") };
}

function dumpOptions(fx: Fixture, sqliteAvailable: boolean = HAS_SQLITE): DumpOptions {
  return {
    rootAbs: fx.root,
    targets: [
      { target: "docs", targetAbs: join(fx.repo, "docs") },
      { target: "data", targetAbs: join(fx.repo, "data") },
    ],
    keep: { keepDaily: 7, keepWeekly: 4, keepMonthly: 12 },
    timeoutMs: 60_000,
    sqliteAvailable,
    allowRootOwned: false,
    scratchRoot: fx.scratch,
    scratchRel: ".tmp",
  };
}

function syncTool(
  cmd: string[],
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string; }> {
  const res = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  return Promise.resolve({
    exitCode: res.exitCode,
    stdout: new TextDecoder().decode(res.stdout),
    stderr: new TextDecoder().decode(res.stderr),
  });
}

function tarTable(archivePath: string): string[] {
  const res = Bun.spawnSync(
    ["tar", "--use-compress-program=zstd -T0", "--list", "--file", archivePath],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (res.exitCode !== 0) throw new Error(`tar -t failed for ${archivePath}`);
  return new TextDecoder().decode(res.stdout).split("\n").map((l) => l.trim()).filter((l) =>
    l.length > 0
  );
}

function archivesOf(root: string, pattern: RegExp): string[] {
  return readdirSync(root).filter((n) => pattern.test(n));
}

function fakeConfig(repo: string, targets: string[]): WorktreeConfig {
  const settings: GiwtSettings = {
    ...DEFAULT_SETTINGS,
    backup: { ...DEFAULT_SETTINGS.backup, root: "backups", targets },
  };
  return { repoRoot: repo, worktreeRoot: repo, treeDir: repo, settings };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("backup dump/verify (real tar)", () => {
  test("full dump writes archive + sha256 sidecar + snar, quiesces sqlite, verifies", async () => {
    const fx = makeFixture("full");
    const result = await runDump(dumpOptions(fx));
    expect(result.pruned).toEqual([]);
    expect(result.dumps.map((d) => d.level)).toEqual(["full", "full"]);

    const docsArchives = archivesOf(fx.root, /^docs\.full\.\d{8}T\d{6}Z\.tar\.zst$/);
    expect(docsArchives).toHaveLength(1);
    const archiveName = docsArchives[0]!;
    const archivePath = join(fx.root, archiveName);
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(readFileSync(archivePath));
    const digest = hasher.digest("hex");
    expect(readFileSync(join(fx.root, `${archiveName}.sha256`), "utf8")).toBe(
      `${digest}  ${archiveName}\n`,
    );
    expect(result.dumps[0]!.sha256).toBe(digest);
    expect(existsSync(join(fx.root, "state", "docs.snar"))).toBe(true);

    const table = tarTable(archivePath);
    expect(table).toContain("docs/a.txt");
    expect(table).toContain("backup-manifest.json");

    const dataArchive = archivesOf(fx.root, /^data\.full\.\d{8}T\d{6}Z\.tar\.zst$/)[0]!;
    const dataTable = tarTable(join(fx.root, dataArchive));
    if (HAS_SQLITE) {
      // Live DB never enters the archive; its snapshot does.
      expect(dataTable).not.toContain("data/store.db");
      expect(dataTable.some((e) => e.startsWith("_giwt-quiesced/data/store.db"))).toBe(true);
      expect(result.skippedDbs).toEqual([]);
    }

    const verdicts = await verifyRoot({
      rootAbs: fx.root,
      targets: ["docs", "data"],
      tool: syncTool,
      scratchRoot: fx.scratch,
    });
    expect(verdicts.map((v) => [v.target, v.ok, v.reason])).toEqual([
      ["docs", true, undefined],
      ["data", true, undefined],
    ]);
  });

  test("second dump rides the .snar chain as an incremental, never overwriting", async () => {
    const fx = makeFixture("inc");
    await runDump(dumpOptions(fx));
    writeFileSync(join(fx.repo, "docs", "b.txt"), "beta\n");
    const second = await runDump(dumpOptions(fx));
    expect(second.dumps.map((d) => d.level)).toEqual(["inc", "inc"]);
    expect(archivesOf(fx.root, /\.tar\.zst$/)).toHaveLength(4);
    expect(existsSync(join(fx.root, "state", "docs.snar"))).toBe(true);
    const verdicts = await verifyRoot({
      rootAbs: fx.root,
      targets: ["docs"],
      tool: syncTool,
      scratchRoot: fx.scratch,
    });
    expect(verdicts[0]!.ok).toBe(true);
    expect(verdicts[0]!.chain).toHaveLength(2);
  });

  test("rotation prunes expired archives but pins the live chain", async () => {
    const fx = makeFixture("rotate");
    await runDump(dumpOptions(fx));
    // An expired stray ~30 days back (valid name, junk bytes) for the docs
    // target: outside the 7-day daily window and every other budget.
    const strayStamp = utcStamp(new Date(Date.now() - 30 * 86_400_000));
    writeFileSync(join(fx.root, `docs.full.${strayStamp}.tar.zst`), "junk");
    writeFileSync(join(fx.root, `docs.full.${strayStamp}.tar.zst.sha256`), "junk\n");
    const opts = dumpOptions(fx);
    // One daily bucket (today) only: the stray is outside it, while the
    // live chain survives via the pin.
    opts.keep = { keepDaily: 1, keepWeekly: 0, keepMonthly: 0 };
    const result = await runDump(opts);
    expect(result.pruned).toContain(`docs.full.${strayStamp}.tar.zst`);
    expect(existsSync(join(fx.root, `docs.full.${strayStamp}.tar.zst.sha256`))).toBe(false);
    // Live chain intact: today's docs full + inc survived the tight budget.
    expect(archivesOf(fx.root, /^docs\..+\.tar\.zst$/)).toHaveLength(2);
  });

  test("dry-run preview plans without writing", async () => {
    const fx = makeFixture("dry");
    const rows = previewDump(dumpOptions(fx));
    expect(rows.map((r) => [r.target, r.level, r.dbs])).toEqual([
      ["docs", "full", 0],
      ["data", "full", HAS_SQLITE ? 1 : 0],
    ]);
    expect(rows.every((r) => r.wouldPrune === 0)).toBe(true);
    expect(existsSync(fx.root)).toBe(false);
  });

  test("missing sqlite3 skips the DB loudly and archives neither live file nor snapshot", async () => {
    if (!HAS_SQLITE) return; // The no-tool path is already exercised then.
    const fx = makeFixture("nosqlite");
    const result = await runDump(dumpOptions(fx, false));
    expect(result.skippedDbs).toHaveLength(1);
    expect(result.skippedDbs[0]!.reason).toContain("sqlite3 CLI not installed");
    const dataArchive = archivesOf(fx.root, /^data\.full\.\d{8}T\d{6}Z\.tar\.zst$/)[0]!;
    const table = tarTable(join(fx.root, dataArchive));
    expect(table.some((e) => e.includes("store.db"))).toBe(false);
    expect(table.some((e) => e.includes("_giwt-quiesced"))).toBe(false);
  });

  test("a failed sqlite snapshot excludes the live DB and reports the skip", async () => {
    const fx = makeFixture("quiesce-fail");
    const outcome = await quiesceTarget({
      target: "data",
      targetAbs: join(fx.repo, "data"),
      staging: join(fx.repo, "staging"),
      toolAvailable: true,
      run: () => Promise.resolve({ exitCode: 1, stderr: "unable to open database file" }),
    });
    expect(outcome.excluded).toHaveLength(1);
    expect(outcome.snapshotDir).toBe("");
    expect(outcome.skipped).toHaveLength(1);
    expect(outcome.skipped[0]!.reason).toContain("exited 1");
  });

  test("verify fails loudly on a corrupted archive (exit + extraction paths)", async () => {
    const fx = makeFixture("corrupt");
    mkdirSync(fx.root, { recursive: true });
    writeFileSync(join(fx.root, "docs.full.20260101T000000Z.tar.zst"), "junk-not-zstd");
    const verdicts = await verifyRoot({
      rootAbs: fx.root,
      targets: ["docs"],
      tool: syncTool,
      scratchRoot: fx.scratch,
    });
    expect(verdicts[0]!.ok).toBe(false);
    expect(verdicts[0]!.reason).toContain("tar -t failed");
  });

  test("mode-safe scratch cleanup removes tar-preserved read-only trees", () => {
    const fx = makeFixture("modesafe");
    mkdirSync(fx.scratch, { recursive: true });
    const scratch = mkdtempSync(join(fx.scratch, "giwt-backup-verify-"));
    // Annex-style modes after a tar extract: dir 0555, file 0444.
    const locked = join(scratch, "locked");
    mkdirSync(locked, { recursive: true });
    writeFileSync(join(locked, "key.txt"), "content\n");
    chmodSync(locked, 0o555);
    chmodSync(join(locked, "key.txt"), 0o444);
    chmodSync(scratch, 0o555);
    removeScratchTree(scratch);
    expect(existsSync(scratch)).toBe(false);
  });

  test("mode-safe cleanup never throws on an already-vanished scratch dir", () => {
    const fx = makeFixture("modesafe-gone");
    expect(() => removeScratchTree(join(fx.scratch, "giwt-backup-verify-none"))).not.toThrow();
  });

  test("dump never archives a leaked giwt-backup-verify-* scratch tree", async () => {
    const fx = makeFixture("exclude");
    const leaked = join(fx.scratch, "giwt-backup-verify-Pbrhtu");
    mkdirSync(join(leaked, "repo"), { recursive: true });
    writeFileSync(join(leaked, "repo", "leftover.txt"), "stale\n");
    const opts = dumpOptions(fx);
    // Target the whole repo so the scratch root is inside the payload.
    opts.targets = [{ target: ".", targetAbs: fx.repo }];
    const result = await runDump(opts);
    const table = tarTable(join(fx.root, result.dumps[0]!.archive));
    expect(table.some((e) => e.includes("giwt-backup-verify-"))).toBe(false);
    expect(table.some((e) => e.endsWith("docs/a.txt"))).toBe(true);
    // A concurrent-live scratch tree also stays out while dump still succeeds.
    expect(existsSync(leaked)).toBe(true);
  });

  test("command usage errors: unknown subcommand, bad target, --dry-run on verify", async () => {
    const fx = makeFixture("usage");
    const config = fakeConfig(fx.repo, ["docs"]);
    const expectThrow = async (args: string[], needle: string): Promise<void> => {
      let message = "";
      try {
        await backup(args, config);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain(needle);
    };
    await expectThrow(["frobnicate"], "unknown subcommand 'frobnicate'");
    await expectThrow([], "a subcommand is required");
    await expectThrow(["verify", "--dry-run"], "--dry-run applies to dump only");
    await expectThrow(["dump", "no-such-dir"], "is not a directory");
    // Caveat gate: targets that climb out of (or bypass) the repo root are
    // refused before any tar runs. Both shapes EXIST on disk, so only the
    // containment check can reject them.
    await expectThrow(["dump", "../"], "outside the repo root");
    await expectThrow(["dump", "/tmp"], "outside the repo root");
  });

  test("command round trip: dry-run preview, real dump, verify through the handler", async () => {
    const fx = makeFixture("roundtrip");
    const config = fakeConfig(fx.repo, ["docs"]);
    const writeSpy = spyOn(process.stdout, "write");
    const emitted = (needle: string): boolean =>
      writeSpy.mock.calls.some((call) => String(call[0]).includes(needle));
    await backup(["dump", "--dry-run"], config);
    expect(emitted("dry-run: 1 target(s) planned")).toBe(true);
    await backup(["dump", "docs"], config);
    expect(emitted("dumped 1 archive(s)")).toBe(true);
    await backup(["verify"], config);
    expect(emitted("verified 1 chain(s)")).toBe(true);
    writeSpy.mockRestore();
  });

  test(
    "annex-detected dump degrades silently when the annex probe is unavailable",
    // Real git/tar spawns with the full [backup] timeout budget — under a
    // parallel suite those can exceed bun's 5s default, so widen the gate.
    async () => {
      // A `.git/annex` dir with no working git-annex behind it: the gate's
      // probe spawn fails, advisory is null, dump proceeds unchanged.
      const fx = makeFixture("annex-probe-fail");
      mkdirSync(join(fx.repo, ".git", "annex"), { recursive: true });
      const config = fakeConfig(fx.repo, ["docs"]);
      const writeSpy = spyOn(process.stdout, "write");
      await backup(["dump"], config);
      expect(writeSpy.mock.calls.some((call) => String(call[0]).includes("annex advisory"))).toBe(
        false,
      );
      expect(writeSpy.mock.calls.some((call) => String(call[0]).includes("dumped 1 archive(s)")))
        .toBe(true);
      writeSpy.mockRestore();
    },
    30_000,
  );

  test("root-owned target is refused by default (deny path, guard precedes tar)", async () => {
    // No privileges needed: any root-owned dir on the system fires the guard
    // (uid === 0 && !allowRootOwned) BEFORE any read, tar, or quiesce runs.
    // /etc is root-owned and statable by any user. The refusal is a HARD
    // failure: dumpLocked throws so nothing is committed.
    const fx = makeFixture("root-owned");
    const opts = dumpOptions(fx);
    opts.targets = [{ target: "etc", targetAbs: "/etc" }];
    let message = "";
    try {
      await runDump(opts);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("owned by root");
    expect(message).toContain("allow_root_owned");
    expect(message).toContain(".snar chains left untouched");
    expect(archivesOf(fx.root, /^etc\./)).toEqual([]);
  });

  test("held backup lock refuses the dump with a remedy", async () => {
    const fx = makeFixture("lock");
    mkdirSync(fx.root, { recursive: true });
    const release = acquireBackupLock(fx.root);
    try {
      let message = "";
      try {
        await runDump(dumpOptions(fx));
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain("could not acquire backup lock");
    } finally {
      release();
    }
  });

  test("a vanished target is a reported problem, not a crash", async () => {
    const fx = makeFixture("gone");
    const opts = dumpOptions(fx);
    opts.targets = [{ target: "gone", targetAbs: join(fx.repo, "gone") }];
    let message = "";
    try {
      await runDump(opts);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("cannot stat target");
    expect(existsSync(join(fx.root, "state", "gone.snar"))).toBe(false);
  });
});

describe("giwt backup command (in-process)", () => {
  test("dump then verify through the command handler", async () => {
    const fx = makeFixture("cmd");
    const config = fakeConfig(fx.repo, ["docs"]);
    const originalExit = process.exitCode;
    try {
      const stdout: string[] = [];
      const spy = spyOn(process.stdout, "write");
      spy.mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });
      await backup(["dump"], config);
      spy.mockRestore();
      expect(process.exitCode ?? 0).toBe(0);
      expect(stdout.join("")).toContain("dumped 1 archive(s)");

      const verifyOut: string[] = [];
      const verifySpy = spyOn(process.stdout, "write");
      verifySpy.mockImplementation((chunk: unknown) => {
        verifyOut.push(String(chunk));
        return true;
      });
      await backup(["verify"], config);
      verifySpy.mockRestore();
      expect(process.exitCode ?? 0).toBe(0);
      expect(verifyOut.join("")).toContain("verified 1 chain(s)");
    } finally {
      process.exitCode = originalExit;
    }
  });
});
