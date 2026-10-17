// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Orchestration runners (status/schedule/remote) + the `backup` arg gates:
 * real state-ledger fixtures, byte-identical schedule output, and a real
 * local rsync transfer for the success path. No network: rsync copies to a
 * scratch dir, tailscale/annex paths go through injected deps.
 */

import { afterAll, describe, expect, spyOn, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { backup } from "../commands/backup";
import { runRemoteGate, runScheduleGate, runStatusGate } from "../commands/backup-gates";
import type { WorktreeConfig } from "../utils/config";
import { DEFAULT_SETTINGS, type GiwtSettings } from "../utils/settings";
import { type AnnexCounts, annexCounts } from "./annex-status";
import { discoverPeers, parsePeers } from "./discover";
import { runDump } from "./dump";
import { runRemoteCommand, runScheduleCommand, runStatusCommand } from "./orchestrate";
import { findSqliteFiles } from "./quiesce";
import { boundedRunner } from "./remote";
import { appendState, readState } from "./state";
import { verifyRoot } from "./verify";

const BASE = join(process.cwd(), ".tmp", "giwt-backup-fixture");

interface Fixture {
  repo: string;
  root: string;
  scratch: string;
}

function makeFixture(name: string): Fixture {
  mkdirSync(BASE, { recursive: true });
  const repo = mkdtempSync(join(BASE, `orch-${name}-`));
  const docs = join(repo, "docs");
  mkdirSync(docs, { recursive: true });
  writeFileSync(join(docs, "a.txt"), "alpha\n");
  return { repo, root: join(repo, "backups"), scratch: mkdtempSync(join(repo, ".scratch")) };
}

function fakeConfig(repo: string): WorktreeConfig {
  const settings: GiwtSettings = {
    ...DEFAULT_SETTINGS,
    backup: { ...DEFAULT_SETTINGS.backup, root: "backups", targets: ["docs"] },
  };
  return { repoRoot: repo, worktreeRoot: repo, treeDir: repo, settings };
}

afterAll(() => {
  rmSync(BASE, { recursive: true, force: true });
});

describe("backup status (runStatusCommand)", () => {
  test("fresh dump+verify+sync events print rows and exit 0", () => {
    const fx = makeFixture("status-fresh");
    const now = Date.now();
    appendState(fx.repo, {
      ts: new Date(now - 60_000).toISOString(),
      kind: "dump",
      remote: "",
      path: fx.root,
      ok: true,
    });
    appendState(fx.repo, {
      ts: new Date(now - 30_000).toISOString(),
      kind: "verify",
      remote: "",
      path: fx.root,
      ok: true,
    });
    appendState(fx.repo, {
      ts: new Date(now - 10_000).toISOString(),
      kind: "sync",
      remote: "nas",
      path: fx.root,
      ok: true,
      offsiteAt: new Date(now - 10_000).toISOString(),
    });
    const spy = spyOn(process.stdout, "write");
    const exit = runStatusCommand(fakeConfig(fx.repo), {
      staleness: "24h",
      strict: true,
      annex: false,
      now,
    });
    const out = spy.mock.calls.map((c) => String(c[0])).join("");
    spy.mockRestore();
    expect(exit).toBe(0);
    expect(out).toContain("dump (local):");
    expect(out).toContain("sync nas:");
    expect(readState(fx.repo).some((e) => e.kind === "alert")).toBe(false);
    rmSync(fx.repo, { recursive: true, force: true });
  });

  test("stale history appends an alert event and --strict exits 1", () => {
    const fx = makeFixture("status-stale");
    const now = Date.now();
    appendState(fx.repo, {
      ts: new Date(now - 48 * 3_600_000).toISOString(),
      kind: "dump",
      remote: "",
      path: fx.root,
      ok: true,
    });
    const exit = runStatusCommand(fakeConfig(fx.repo), {
      staleness: "24h",
      strict: true,
      annex: false,
      now,
    });
    expect(exit).toBe(1);
    const alerts = readState(fx.repo).filter((e) => e.kind === "alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.note).toContain("24.0h");
    rmSync(fx.repo, { recursive: true, force: true });
  });

  test("--annex with an injected inventory prints counts and notes", () => {
    const fx = makeFixture("status-annex");
    const counts: AnnexCounts = { whereisFiles: 3, unusedKeys: 1, note: "annex drained" };
    const spy = spyOn(process.stdout, "write");
    const exit = runStatusCommand(
      fakeConfig(fx.repo),
      { staleness: "24h", strict: false, annex: true },
      { annex: () => counts },
    );
    const out = spy.mock.calls.map((c) => String(c[0])).join("");
    spy.mockRestore();
    expect(exit).toBe(0);
    expect(out).toContain("annex whereis files: 3");
    expect(out).toContain("annex unused keys: 1");
    rmSync(fx.repo, { recursive: true, force: true });
  });
});

describe("backup schedule (runScheduleCommand)", () => {
  test("output is byte-identical across calls and names env vars only", () => {
    const spy = spyOn(process.stdout, "write");
    runScheduleCommand({ dryRun: true, remoteKind: "rsync", staleness: "24h", calendar: "daily" });
    const first = spy.mock.calls.map((c) => String(c[0])).join("");
    spy.mockClear();
    runScheduleCommand({ dryRun: true, remoteKind: "rsync", staleness: "24h", calendar: "daily" });
    const second = spy.mock.calls.map((c) => String(c[0])).join("");
    spy.mockRestore();
    expect(second).toBe(first);
    expect(first).toContain("systemd units");
    expect(first).toContain("OnCalendar=daily");
    expect(first).toContain("backup status --staleness 24h --strict");
    expect(first).toContain("RSYNC_PASSWORD");
  });
});

describe("backup remote (runRemoteCommand)", () => {
  test("--discover prints injected peers without touching state", async () => {
    const fx = makeFixture("remote-discover");
    const spy = spyOn(process.stdout, "write");
    await runRemoteCommand(fakeConfig(fx.repo), {
      kind: "rsync",
      dest: "",
      prune: false,
      discover: true,
    }, {
      discover: async () => ({
        peers: [{ dnsName: "box.tailnet.", hostName: "box", online: false }],
        note: "",
      }),
    });
    const out = spy.mock.calls.map((c) => String(c[0])).join("");
    spy.mockRestore();
    expect(out).toContain("box.tailnet. (offline) → try: --dest box");
    expect(existsSync(join(fx.repo, ".backup.jsonl"))).toBe(false);
    rmSync(fx.repo, { recursive: true, force: true });
  });

  test("missing --dest and missing backup root are hard errors", async () => {
    const fx = makeFixture("remote-errors");
    await expect(runRemoteCommand(fakeConfig(fx.repo), {
      kind: "rsync",
      dest: "",
      prune: false,
      discover: false,
    })).rejects.toThrow("--dest <remote> is required");
    await expect(runRemoteCommand(fakeConfig(fx.repo), {
      kind: "rsync",
      dest: "nas:backups",
      prune: false,
      discover: false,
    })).rejects.toThrow("no backup root");
    rmSync(fx.repo, { recursive: true, force: true });
  });

  test("failed verify refuses the transfer and never appends a sync event", async () => {
    const fx = makeFixture("remote-gate");
    mkdirSync(fx.root, { recursive: true });
    writeFileSync(join(fx.root, "docs.full.20260101T000000Z.tar.zst"), "junk-not-zstd");
    await expect(runRemoteCommand(fakeConfig(fx.repo), {
      kind: "rsync",
      dest: "nas:backups",
      prune: false,
      discover: false,
    })).rejects.toThrow("verify failed for docs");
    const events = readState(fx.repo);
    expect(events.some((e) => e.kind === "sync")).toBe(false);
    expect(events.some((e) => e.kind === "verify" && e.ok === false)).toBe(true);
    rmSync(fx.repo, { recursive: true, force: true });
  });

  test("prune is refused without [backup] allow_remote_delete (two-key auth)", async () => {
    const fx = makeFixture("remote-prune");
    mkdirSync(join(fx.repo, "docs"), { recursive: true });
    writeFileSync(join(fx.repo, "docs", "a.txt"), "alpha\n");
    await runDump({
      rootAbs: fx.root,
      targets: [{ target: "docs", targetAbs: join(fx.repo, "docs") }],
      keep: { keepDaily: 7, keepWeekly: 4, keepMonthly: 12 },
      timeoutMs: 60_000,
      sqliteAvailable: false,
      allowRootOwned: false,
      scratchRoot: fx.scratch,
    });
    await expect(runRemoteCommand(fakeConfig(fx.repo), {
      kind: "rsync",
      dest: join(fx.scratch, "offsite"),
      prune: true,
      discover: false,
    })).rejects.toThrow("server-side deletion refused");
    expect(readState(fx.repo).some((e) => e.kind === "sync")).toBe(false);
    rmSync(fx.repo, { recursive: true, force: true });
  });

  test("failed transfer surfaces the runner exit as an error", async () => {
    const fx = makeFixture("remote-fail");
    mkdirSync(join(fx.repo, "docs"), { recursive: true });
    writeFileSync(join(fx.repo, "docs", "a.txt"), "alpha\n");
    await runDump({
      rootAbs: fx.root,
      targets: [{ target: "docs", targetAbs: join(fx.repo, "docs") }],
      keep: { keepDaily: 7, keepWeekly: 4, keepMonthly: 12 },
      timeoutMs: 60_000,
      sqliteAvailable: false,
      allowRootOwned: false,
      scratchRoot: fx.scratch,
    });
    await expect(runRemoteCommand(fakeConfig(fx.repo), {
      kind: "rsync",
      dest: join(fx.scratch, "no-such-parent", "offsite"),
      prune: false,
      discover: false,
    })).rejects.toThrow("rsync exited");
    expect(readState(fx.repo).some((e) => e.kind === "sync")).toBe(false);
    rmSync(fx.repo, { recursive: true, force: true });
  });

  test("verified backup transfers via local rsync and appends offsiteAt", async () => {
    const fx = makeFixture("remote-success");
    mkdirSync(join(fx.repo, "docs"), { recursive: true });
    writeFileSync(join(fx.repo, "docs", "a.txt"), "alpha\n");
    await runDump({
      rootAbs: fx.root,
      targets: [{ target: "docs", targetAbs: join(fx.repo, "docs") }],
      keep: { keepDaily: 7, keepWeekly: 4, keepMonthly: 12 },
      timeoutMs: 60_000,
      sqliteAvailable: false,
      allowRootOwned: false,
      scratchRoot: fx.scratch,
    });
    const dest = join(fx.scratch, "offsite-copy");
    await runRemoteCommand(fakeConfig(fx.repo), {
      kind: "rsync",
      dest,
      prune: false,
      discover: false,
    });
    const synced = readdirSync(dest).filter((n) => n.endsWith(".tar.zst"));
    expect(synced.length).toBeGreaterThan(0);
    const sync = readState(fx.repo).find((e) => e.kind === "sync");
    expect(sync?.ok).toBe(true);
    expect(sync?.remote).toBe(dest);
    expect(sync?.offsiteAt).toBeDefined();
    rmSync(fx.repo, { recursive: true, force: true });
  });
});

describe("backup arg gates (status/schedule/remote)", () => {
  test("bad flags raise usage errors naming the expectation", async () => {
    const fx = makeFixture("gates-bad");
    const config = fakeConfig(fx.repo);
    await expect(runStatusGate(["--staleness", "xx"], config)).rejects.toThrow(
      "--staleness expects",
    );
    await expect(runRemoteGate(["--target", "ftp"], config)).rejects.toThrow(
      "--target expects rclone|rsync|ssh",
    );
    rmSync(fx.repo, { recursive: true, force: true });
  });

  test("valid gates parse through: status gate ok path, schedule gate, remote dest gate", async () => {
    const fx = makeFixture("gates-ok");
    const config = fakeConfig(fx.repo);
    const now = Date.now();
    appendState(fx.repo, {
      ts: new Date(now).toISOString(),
      kind: "dump",
      remote: "",
      path: fx.root,
      ok: true,
    });
    const prevExit = process.exitCode;
    process.exitCode = undefined;
    const spy = spyOn(process.stdout, "write");
    await runStatusGate(["--staleness", "1h"], config);
    expect(process.exitCode ?? 0).toBe(0);
    spy.mockClear();
    runScheduleGate(["--remote", "ssh", "--calendar", "hourly"]);
    const out = spy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain("GIWT_SSH_HOST");
    spy.mockRestore();
    await expect(runRemoteGate([], config)).rejects.toThrow("--dest <remote> is required");
    process.exitCode = prevExit;
    rmSync(fx.repo, { recursive: true, force: true });
  });
});

describe("discover parsers", () => {
  test("parsePeers sorts and strips trailing dots; failures degrade to a note", async () => {
    const peers = parsePeers(JSON.stringify({
      Peer: {
        b: { DNSName: "b.tailnet.", HostName: "bee", Online: true },
        a: { DNSName: "a.tailnet.", Online: false },
      },
    }));
    expect(peers.map((p) => p.dnsName)).toEqual(["a.tailnet", "b.tailnet"]);
    expect(peers[1]!.hostName).toBe("bee");
    const fail = await discoverPeers(() =>
      Promise.resolve({ exitCode: 1, stdout: "", stderr: "down" })
    );
    expect(fail.peers).toEqual([]);
    expect(fail.note).toContain("tailscale status failed");
  });

  test("discoverPeers notes empty peer lists and stays quiet on peers", async () => {
    const empty = await discoverPeers(() =>
      Promise.resolve({ exitCode: 0, stdout: "{}", stderr: "" })
    );
    expect(empty.peers).toEqual([]);
    expect(empty.note).toContain("no peers");
    const ok = await discoverPeers(() =>
      Promise.resolve({
        exitCode: 0,
        stdout: JSON.stringify({ Peer: { x: { DNSName: "x.t.", HostName: "x", Online: true } } }),
        stderr: "",
      })
    );
    expect(ok.peers).toHaveLength(1);
    expect(ok.note).toBe("");
  });
});

describe("annex inventory seam", () => {
  test("annexCounts degrades on absent annex and counts rows when present", () => {
    const absent = annexCounts("/no/repo", () => ({
      exitCode: 1,
      stdout: "",
      stderr: "annex: not found",
    }));
    expect(absent.whereisFiles).toBe(0);
    expect(absent.note).toContain("not available");
    const present = annexCounts("/repo", (cmd) =>
      cmd.includes("whereis")
        ? { exitCode: 0, stdout: "whereis: 2 copies found\nwhereis: 1 copy found\n", stderr: "" }
        : { exitCode: 0, stdout: "  1   somekey\n", stderr: "" });
    const counts: AnnexCounts = present;
    expect(counts.whereisFiles).toBe(2);
    expect(counts.unusedKeys).toBe(1);
    expect(counts.note).toBe("");
  });

  test("--annex without injected deps walks the real spawn seam (annex absent)", () => {
    const fx = makeFixture("status-annex-real");
    const spy = spyOn(process.stdout, "write");
    const exit = runStatusCommand(fakeConfig(fx.repo), {
      staleness: "24h",
      strict: false,
      annex: true,
    });
    const out = spy.mock.calls.map((c) => String(c[0])).join("");
    spy.mockRestore();
    expect(exit).toBe(0);
    expect(out).toContain("annex whereis files: 0");
    rmSync(fx.repo, { recursive: true, force: true });
  });
});

describe("bounded runner stdin path", () => {
  test("streams a stdin file into the command (ssh-style transfer)", async () => {
    const fx = makeFixture("runner-stdin");
    const out = join(fx.scratch, "streamed.bin");
    const res = await boundedRunner(60_000)(["tee", out], fx.repo, join(fx.repo, "docs", "a.txt"));
    expect(res.exitCode).toBe(0);
    expect(readFileSync(out, "utf8")).toBe("alpha\n");
    rmSync(fx.repo, { recursive: true, force: true });
  });
});

describe("backup handler verify failure path", () => {
  test("verify through the handler prints FAIL and sets exit 1", async () => {
    const fx = makeFixture("handler-verify-fail");
    mkdirSync(fx.root, { recursive: true });
    writeFileSync(join(fx.root, "docs.full.20260101T000000Z.tar.zst"), "junk-not-zstd");
    const spy = spyOn(process.stdout, "write");
    await backup(["verify"], fakeConfig(fx.repo));
    const out = spy.mock.calls.map((c) => String(c[0])).join("");
    spy.mockRestore();
    expect(out).toContain("FAIL —");
    expect(process.exitCode ?? 0).toBe(1);
    process.exitCode = 0;
    expect(readState(fx.repo).some((e) => e.kind === "verify" && e.ok === false)).toBe(true);
    rmSync(fx.repo, { recursive: true, force: true });
  });
});

describe("verify and quiesce edge paths", () => {
  test("verifyRoot reports requested targets without archives as empty-chain failures", async () => {
    const fx = makeFixture("verify-empty");
    const verdicts = await verifyRoot({
      rootAbs: fx.root,
      targets: ["ghost"],
      tool: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      scratchRoot: fx.scratch,
    });
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]!.ok).toBe(false);
    expect(verdicts[0]!.reason).toContain("no full archive found");
    rmSync(fx.repo, { recursive: true, force: true });
  });

  test("findSqliteFiles walks subdirs, skips symlinks, and tolerates unreadable dirs", () => {
    const fx = makeFixture("quiesce-scan");
    mkdirSync(join(fx.repo, "deep", "nest"), { recursive: true });
    writeFileSync(join(fx.repo, "deep", "nest", "x.db"), "");
    symlinkSync(join(fx.repo, "deep"), join(fx.repo, "link"), "dir");
    const refs = findSqliteFiles(fx.repo);
    expect(refs.some((r) => r.rel === join("deep", "nest", "x.db"))).toBe(true);
    expect(refs.every((r) => !r.abs.includes("link"))).toBe(true);
    chmodSync(join(fx.repo, "deep"), 0o000);
    // Unreadable subtree: scan must not throw (as root the dir stays
    // readable, so both outcomes are acceptable — the contract is no-crash).
    const afterChmod = findSqliteFiles(fx.repo);
    chmodSync(join(fx.repo, "deep"), 0o755);
    expect(Array.isArray(afterChmod)).toBe(true);
    rmSync(fx.repo, { recursive: true, force: true });
  });
});
