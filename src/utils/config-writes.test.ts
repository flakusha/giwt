// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the lifecycle git-config write funnel: allow-mode logging +
 * writes, refusal with remedy (settings + env override), and the integration
 * through configureGpgSigningSilently (allow writes, refuse blocks).
 */

import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configureGpgSigningSilently } from "./config";
import { CONFIG_WRITES_ENV, gitConfigSet, resolveConfigWritesMode } from "./config-writes";
import { beginRun, finishActiveRun } from "./runlog";
import { scratchRoot } from "./scratch-tmp";
import { DEFAULT_SETTINGS } from "./settings";

const EXIT_SENTINEL = "__exit__:1";

/** Minimal git repo; `withConfig` optionally writes a giwt.toml layer. */
function makeRepo(configToml?: string): string {
  const root = mkdtempSync(join(scratchRoot(), "giwt-cfgwrites-"));
  gitRun(["init", "-q", "-b", "main"], root);
  if (configToml !== undefined) {
    writeFileSync(join(root, "giwt.toml"), configToml);
  }
  return root;
}

/** git with ambient GIT_* context stripped (pre-commit exports relative paths). */
function gitRun(args: string[], cwd: string): string {
  const env = { ...process.env } as Record<string, string | undefined>;
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: env as Record<string, string>,
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}

/** Mock process.exit to throw a sentinel; returns the spy. */
function mockExit(): ReturnType<typeof spyOn> {
  return spyOn(process, "exit").mockImplementation(
    ((code: number) => {
      throw new Error(`${EXIT_SENTINEL.replace(":1", `:${code}`)}`);
    }) as typeof process.exit,
  );
}

/** Join mocked stdout chunks (logger writes via raw, not console). */
function outText(spy: { mock: { calls: unknown[][]; }; }): string {
  return spy.mock.calls.map((c) => String(c[0])).join("");
}

describe("resolveConfigWritesMode", () => {
  const prev = process.env[CONFIG_WRITES_ENV];

  afterEach(() => {
    if (prev === undefined) delete process.env[CONFIG_WRITES_ENV];
    else process.env[CONFIG_WRITES_ENV] = prev;
  });

  it("defaults to allow", () => {
    delete process.env[CONFIG_WRITES_ENV];
    expect(resolveConfigWritesMode()).toBe("allow");
    expect(resolveConfigWritesMode(DEFAULT_SETTINGS)).toBe("allow");
  });

  it("honors [git] config_writes = refuse", () => {
    delete process.env[CONFIG_WRITES_ENV];
    expect(
      resolveConfigWritesMode({
        ...DEFAULT_SETTINGS,
        git: { ...DEFAULT_SETTINGS.git, configWrites: "refuse" },
      }),
    )
      .toBe("refuse");
  });

  it("env override wins over an allow setting", () => {
    process.env[CONFIG_WRITES_ENV] = "1";
    expect(resolveConfigWritesMode(DEFAULT_SETTINGS)).toBe("refuse");
  });
});

describe("gitConfigSet", () => {
  let root: string;
  let outSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn> | null;
  const prev = process.env[CONFIG_WRITES_ENV];

  afterEach(() => {
    if (prev === undefined) delete process.env[CONFIG_WRITES_ENV];
    else process.env[CONFIG_WRITES_ENV] = prev;
    exitSpy?.mockRestore();
    outSpy?.mockRestore();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("allow mode (default) writes the key and logs it", () => {
    delete process.env[CONFIG_WRITES_ENV];
    // Pin the logger: other test files may leak GIWT_OUTPUT/GIWT_LOG.
    const prevOut = process.env.GIWT_OUTPUT;
    const prevLog = process.env.GIWT_LOG;
    process.env.GIWT_OUTPUT = "simple";
    process.env.GIWT_LOG = "info";
    root = makeRepo();
    outSpy = spyOn(process.stdout, "write");
    const errSpy = spyOn(process.stderr, "write");
    gitConfigSet({ root, entries: [{ key: "gate.probe", value: "ok" }], reason: "test lifecycle" });
    if (prevOut === undefined) delete process.env.GIWT_OUTPUT;
    else process.env.GIWT_OUTPUT = prevOut;
    if (prevLog === undefined) delete process.env.GIWT_LOG;
    else process.env.GIWT_LOG = prevLog;
    expect(gitRun(["config", "--get", "gate.probe"], root)).toBe("ok");
    const out = outText(outSpy) + errSpy.mock.calls.map((c) => String(c[0])).join("");
    errSpy.mockRestore();
    expect(out).toContain("gate.probe = ok");
    expect(out).toContain("test lifecycle");
  });

  it("refuse mode (settings) exits 1 with a remedy and writes nothing", () => {
    delete process.env[CONFIG_WRITES_ENV];
    root = makeRepo("[git]\nconfig_writes = \"refuse\"\n");
    outSpy = spyOn(process.stdout, "write");
    const errSpy = spyOn(process.stderr, "write");
    exitSpy = mockExit();
    expect(() =>
      gitConfigSet({ root, entries: [{ key: "gate.probe", value: "nope" }], reason: "test" })
    ).toThrow(/__exit__:1/);
    expect(exitSpy.mock.calls[0]?.[0]).toBe(1);
    const out = outText(outSpy) + errSpy.mock.calls.map((c) => String(c[0])).join("");
    errSpy.mockRestore();
    expect(out).toContain("refused");
    expect(out).toContain("config_writes = \"allow\"");
    expect(out).toContain(CONFIG_WRITES_ENV);
    expect(existsSync(join(root, ".git", "refs", "heads"))).toBe(true);
    expect(() => gitRun(["config", "--get", "gate.probe"], root)).toThrow(/gate.probe/);
  });

  it("env override forces refusal even when settings allow", () => {
    process.env[CONFIG_WRITES_ENV] = "1";
    root = makeRepo("[git]\nconfig_writes = \"allow\"\n");
    outSpy = spyOn(process.stdout, "write");
    exitSpy = mockExit();
    expect(() =>
      gitConfigSet({ root, entries: [{ key: "gate.probe", value: "nope" }], reason: "test" })
    ).toThrow(/__exit__:1/);
    expect(outText(outSpy)).toContain(CONFIG_WRITES_ENV);
  });

  it("multi-entry writes land in one funnel call", () => {
    delete process.env[CONFIG_WRITES_ENV];
    root = makeRepo();
    outSpy = spyOn(process.stdout, "write");
    gitConfigSet({
      root,
      entries: [{ key: "a.k1", value: "v1" }, { key: "a.k2", value: "v2" }],
      reason: "pair write",
    });
    expect(gitRun(["config", "--get", "a.k1"], root)).toBe("v1");
    expect(gitRun(["config", "--get", "a.k2"], root)).toBe("v2");
  });

  it("allow mode records a git-config event in the active run record", () => {
    delete process.env[CONFIG_WRITES_ENV];
    root = makeRepo();
    const treeDir = join(root, "tree");
    mkdirSync(treeDir, { recursive: true });
    const recorder = beginRun(
      {
        repoRoot: root,
        worktreeRoot: root,
        treeDir,
        settings: structuredClone(DEFAULT_SETTINGS),
      },
      "test-cmd",
      [],
      null,
      "cfgwrites",
    );
    if (!recorder) throw new Error("run-record fixture could not be created");
    try {
      gitConfigSet({
        root,
        entries: [{ key: "gate.probe", value: "ok" }],
        reason: "test lifecycle",
      });
      const events = readFileSync(join(recorder.dir, "events.jsonl"), "utf8");
      expect(events).toContain("\"git-config\"");
      expect(events).toContain("test lifecycle");
      expect(events).toContain("gate.probe=ok");
    } finally {
      finishActiveRun(0);
    }
  });
});

describe("configureGpgSigningSilently through the funnel", () => {
  let root: string;
  let exitSpy: ReturnType<typeof spyOn> | null;
  const prev = process.env[CONFIG_WRITES_ENV];

  afterEach(() => {
    if (prev === undefined) delete process.env[CONFIG_WRITES_ENV];
    else process.env[CONFIG_WRITES_ENV] = prev;
    exitSpy?.mockRestore();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  /** Stub gpg inventory probes so both keys appear present. */
  function withStubGpg(fn: () => void): void {
    const real = Bun.spawnSync;
    Bun.spawnSync = ((cmd: string[], options?: { env?: Record<string, string>; }) => {
      if (cmd[0] === "gpg") {
        return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
      }
      return real(cmd, options);
    }) as typeof Bun.spawnSync;
    try {
      fn();
    } finally {
      Bun.spawnSync = real;
    }
  }

  it("allow mode: the write happens", () => {
    delete process.env[CONFIG_WRITES_ENV];
    root = makeRepo();
    mkdirSync(join(root, ".git"), { recursive: true });
    withStubGpg(() => configureGpgSigningSilently(root, "0123456789ABCDEF"));
    expect(gitRun(["config", "--get", "commit.gpgsign"], root)).toBe("true");
    expect(gitRun(["config", "--get", "user.signingkey"], root)).toBe("0123456789ABCDEF");
  });

  it("refuse mode: the write is blocked and the refusal is logged", () => {
    delete process.env[CONFIG_WRITES_ENV];
    root = makeRepo("[git]\nconfig_writes = \"refuse\"\n");
    const outSpy = spyOn(process.stdout, "write");
    const errSpy = spyOn(process.stderr, "write");
    exitSpy = mockExit();
    withStubGpg(() => {
      expect(() => configureGpgSigningSilently(root, "0123456789ABCDEF")).toThrow(/__exit__:1/);
    });
    const out = outSpy.mock.calls.map((c) => String(c[0])).join("")
      + errSpy.mock.calls.map((c) => String(c[0])).join("");
    errSpy.mockRestore();
    expect(out).toContain("commit.gpgsign");
    expect(() => gitRun(["config", "--get", "commit.gpgsign"], root)).toThrow(/commit.gpgsign/);
  });
});
