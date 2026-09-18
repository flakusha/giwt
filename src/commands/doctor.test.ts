// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the doctor command surface (parseArgs, collectFiles, writeAll).
 *
 * `doctor()` itself is exercised by the integration smoke runs that write
 * 14 files end-to-end; this file covers the pure logic that's worthwhile
 * pinning without a subprocess: arg parsing, file dispatch, and merge.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DoctorCheckReport } from "../doctor/check.ts";
import { detectProject } from "../doctor/detect.ts";
import type { ProjectReport } from "../doctor/detect.ts";
import type { GeneratedFile } from "../doctor/types.ts";
import type { WorktreeConfig } from "../utils/config.ts";
import { isolatedGitEnv } from "../utils/git.ts";
import { beginRun, finishActiveRun } from "../utils/runlog.ts";
import { DEFAULT_SETTINGS } from "../utils/settings.ts";
import { collectFiles, doctor, parseArgs, writeAll } from "./doctor.ts";

describe("parseArgs", () => {
  it("defaults to dry-run when no flags passed", () => {
    const opts = parseArgs([]);
    expect(opts.dryRun).toBe(true);
    expect(opts.tools).toBeUndefined();
    expect(opts.root).toBeUndefined();
  });

  it("--apply flips dry-run off", () => {
    expect(parseArgs(["--apply"]).dryRun).toBe(false);
  });

  it("--tool takes space-separated value", () => {
    const opts = parseArgs(["--tool", "oxlint,biome,knip"]);
    expect(opts.tools).toEqual(["oxlint", "biome", "knip"]);
  });

  it("--tool=value form parses correctly", () => {
    expect(parseArgs(["--tool=oxlint"]).tools).toEqual(["oxlint"]);
  });

  it("--tool filters empty entries from CSV", () => {
    expect(parseArgs(["--tool", "oxlint,,biome,"]).tools).toEqual(["oxlint", "biome"]);
  });

  it("--root takes space-separated value", () => {
    expect(parseArgs(["--root", "/tmp/foo"]).root).toBe("/tmp/foo");
  });

  it("--root=value form parses correctly", () => {
    expect(parseArgs(["--root=/tmp/foo"]).root).toBe("/tmp/foo");
  });

  it("combines flags in any order", () => {
    const opts = parseArgs(["--root", "/tmp/y", "--apply", "--tool", "oxlint,knip"]);
    expect(opts.dryRun).toBe(false);
    expect(opts.root).toBe("/tmp/y");
    expect(opts.tools).toEqual(["oxlint", "knip"]);
  });

  it("errors with __exit:1 on unknown flag (e.g. misplaced 'check' subcommand)", () => {
    const origExit = process.exit;
    const exitCalls: number[] = [];
    process.exit = ((code: number) => {
      exitCalls.push(code);
      throw new Error(`__exit:${code}`);
    }) as never;
    try {
      expect(() => parseArgs(["--tool", "oxlint", "check"])).toThrow("__exit:1");
      expect(exitCalls).toEqual([1]);
    } finally {
      process.exit = origExit;
    }
  });
});

describe("writeAll", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "giwt-doctor-writeall-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("writes a non-merge file verbatim", () => {
    const files: GeneratedFile[] = [{ path: "hello.txt", content: "hi\n" }];
    expect(writeAll(root, files)).toBe(1);
    expect(readFileSync(join(root, "hello.txt"), "utf8")).toBe("hi\n");
  });

  it("overwrites a non-merge file when it already exists", () => {
    writeFileSync(join(root, "hello.txt"), "old");
    const files: GeneratedFile[] = [{ path: "hello.txt", content: "new\n" }];
    expect(writeAll(root, files)).toBe(1);
    expect(readFileSync(join(root, "hello.txt"), "utf8")).toBe("new\n");
  });

  it("creates parent directories recursively", () => {
    const files: GeneratedFile[] = [{
      path: ".githooks/pre-commit",
      content: "#!/bin/sh\n",
      executable: true,
    }];
    expect(writeAll(root, files)).toBe(1);
    expect(readFileSync(join(root, ".githooks/pre-commit"), "utf8")).toBe("#!/bin/sh\n");
  });

  it("merges package.json scripts without losing user scripts", () => {
    const existing = {
      name: "real",
      scripts: { build: "tsc", test: "bun test", myscript: "echo hi" },
    };
    writeFileSync(join(root, "package.json"), JSON.stringify(existing));
    const incoming = { scripts: { lint: "oxlint", fmt: "dprint fmt" } };
    const files: GeneratedFile[] = [{
      path: "package.json",
      content: JSON.stringify(incoming),
      merge: true,
    }];
    expect(writeAll(root, files)).toBe(1);
    const merged = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(merged.name).toBe("real");
    expect(merged.scripts.build).toBe("tsc");
    expect(merged.scripts.test).toBe("bun test");
    expect(merged.scripts.myscript).toBe("echo hi");
    expect(merged.scripts.lint).toBe("oxlint");
    expect(merged.scripts.fmt).toBe("dprint fmt");
  });

  it("falls back to overwrite when existing JSON is invalid", () => {
    writeFileSync(join(root, "package.json"), "{ not valid json");
    const files: GeneratedFile[] = [{
      path: "package.json",
      content: JSON.stringify({ scripts: { lint: "oxlint" } }),
      merge: true,
    }];
    // Should NOT throw — fallback to overwrite so the user is unblocked.
    expect(writeAll(root, files)).toBe(1);
    const written = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(written.scripts.lint).toBe("oxlint");
  });

  it("writes a merge file as-is when no existing file is present", () => {
    const files: GeneratedFile[] = [{
      path: "package.json",
      content: JSON.stringify({ scripts: { lint: "oxlint" } }),
      merge: true,
    }];
    expect(writeAll(root, files)).toBe(1);
    expect(existsSync(join(root, "package.json"))).toBe(true);
  });

  it("counts every written file, even on fallback path", () => {
    writeFileSync(join(root, "a.txt"), "old");
    writeFileSync(join(root, "b.txt"), "old");
    const files: GeneratedFile[] = [
      { path: "a.txt", content: "new\n" },
      { path: "b.txt", content: "new\n" },
    ];
    expect(writeAll(root, files)).toBe(2);
  });

  it("lets incoming non-scripts keys overwrite existing values", () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "old", scripts: {} }));
    const files: GeneratedFile[] = [{
      path: "package.json",
      content: JSON.stringify({ name: "generated", license: "MIT" }),
      merge: true,
    }];
    expect(writeAll(root, files)).toBe(1);
    const merged = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(merged.name).toBe("generated");
    expect(merged.license).toBe("MIT");
  });
});

describe("detectProject (sanity, contract surface for doctor)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "giwt-doctor-detect-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("baseReport matches what detectProject returns for a minimal bun TS project", () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "smoke", type: "module" }));
    writeFileSync(join(root, "bun.lock"), "");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/index.ts"), "export const x = 1;");
    const r = detectProject(root);
    expect(r.languages).toContain("typescript");
    expect(r.packageManager).toBe("bun");
    expect(r.existing.oxlint).toBe(false);
    expect(r.existing.preCommit).toBe(false);
  });
});

// ── doctor() end-to-end over scratch repos ─────────────────────
// Resource contract: every fixture is a fresh mkdtemp dir owned by the
// test and removed in afterEach; fixtures are never written to a fixed
// path, so files run in parallel without collisions.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratchDir(): string {
  const root = mkdtempSync(join(tmpdir(), "giwt-doctor-e2e-"));
  dirs.push(root);
  return root;
}

/** Minimal bun+TS project: no linter, no hooks, no git. */
function tsRepo(): string {
  const root = scratchDir();
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "e2e", type: "module" }));
  writeFileSync(join(root, "bun.lock"), "");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "index.ts"), "export const x = 1;\n");
  return root;
}

function configFor(root: string): WorktreeConfig {
  return { repoRoot: root, worktreeRoot: root, treeDir: root, settings: DEFAULT_SETTINGS };
}

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

function exitSentinel(): { calls: number[]; restore: () => void; } {
  const original = process.exit;
  const calls: number[] = [];
  process.exit = ((code?: number) => {
    calls.push(code ?? 0);
    throw new Error(`__exit:${code}`);
  }) as never;
  return {
    calls,
    restore: () => {
      process.exit = original;
    },
  };
}

function git(...args: string[]): void {
  const res = Bun.spawnSync(["git", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: isolatedGitEnv(),
  });
  if (res.exitCode !== 0) throw new Error(res.stderr.toString());
}

function gitConfigRead(repo: string, key: string): string {
  const res = Bun.spawnSync(["git", "-C", repo, "config", "--get", key], {
    stdout: "pipe",
    stderr: "pipe",
    env: isolatedGitEnv(),
  });
  return res.stdout.toString().trim();
}

function gitRepo(): string {
  const root = tsRepo();
  git("init", "-q", "-b", "main", root);
  return root;
}

/** Run a setup-mode call expected to exit; returns captured output. */
async function expectSetupExit(
  args: string[],
  cfg: WorktreeConfig,
): Promise<{ threw: boolean; calls: number[]; out: string; }> {
  const exit = exitSentinel();
  const cap = capture();
  let threw = false;
  let out = "";
  try {
    await doctor(args, cfg);
  } catch (error) {
    threw = String(error).includes("__exit:1");
  } finally {
    out = cap.text();
    cap.restore();
    exit.restore();
  }
  return { threw, calls: exit.calls, out };
}

describe("doctor() setup mode", () => {
  it("prints help for --help and -h without touching the filesystem", async () => {
    const root = tsRepo();
    for (const flag of ["--help", "-h"]) {
      const cap = capture();
      try {
        await doctor([flag], configFor(root));
      } finally {
        cap.restore();
      }
      expect(cap.text()).toContain("Usage: giwt doctor [--apply]");
      expect(cap.text()).toContain("Check ids: lint, typecheck, tests, knip, jscpd, todo");
    }
    expect(existsSync(join(root, ".oxlintrc.json"))).toBe(false);
  });

  it("dry-run detects, recommends, plans — and writes nothing", async () => {
    const root = tsRepo();
    writeFileSync(join(root, ".prettierrc.json"), "{}");
    const cap = capture();
    try {
      await doctor([], configFor(root));
    } finally {
      cap.restore();
    }
    const out = cap.text();
    expect(out).toContain("doctor: detect");
    expect(out).toContain("packageManager: bun");
    expect(out).toContain("agentEmail:     (none — push protection off)");
    expect(out).toContain("doctor: recommend");
    // add / already-present / skip markers all render.
    expect(out).toContain("[+] oxlint");
    expect(out).toContain("[=] prettier");
    expect(out).toContain("[-] eslint");
    expect(out).toContain("doctor: plan");
    expect(out).toContain("Dry-run only");
    expect(existsSync(join(root, ".oxlintrc.json"))).toBe(false);
  });

  it("warns when the resolved root sits inside a linked worktree", async () => {
    const repo = tsRepo();
    const wt = join(repo, "tree", "main");
    mkdirSync(join(wt, "src"), { recursive: true });
    writeFileSync(join(wt, "package.json"), JSON.stringify({ name: "wt" }));
    writeFileSync(join(wt, "src", "index.ts"), "export const y = 2;\n");
    const cfg: WorktreeConfig = {
      repoRoot: repo,
      worktreeRoot: wt,
      treeDir: join(repo, "tree"),
      settings: DEFAULT_SETTINGS,
    };
    const cap = capture();
    try {
      await doctor([], cfg);
    } finally {
      cap.restore();
    }
    expect(cap.text()).toContain("running inside a worktree");
  });

  it("--apply writes configs and applies git config side-effects", async () => {
    const root = gitRepo();
    const cap = capture();
    try {
      await doctor(["--apply"], configFor(root));
    } finally {
      cap.restore();
    }
    const out = cap.text();
    expect(out).toContain("doctor: apply");
    expect(out).toContain("Wrote ");
    expect(existsSync(join(root, ".oxlintrc.json"))).toBe(true);
    expect(existsSync(join(root, ".gitignore"))).toBe(true);
    expect(existsSync(join(root, ".editorconfig"))).toBe(true);
    expect(existsSync(join(root, ".githooks", "pre-commit"))).toBe(true);
    expect(gitConfigRead(root, "pull.ff")).toBe("only");
    expect(gitConfigRead(root, "branch.main.rebase")).toBe("true");
    expect(gitConfigRead(root, "core.hooksPath")).toBe(".githooks");
    // User fields survive the package.json merge.
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      name?: string;
      scripts?: Record<string, string>;
    };
    expect(pkg.name).toBe("e2e");
    expect(pkg.scripts?.["lint"]).toContain("oxlint");
  });

  it("second --apply skips re-configuring linear history", async () => {
    const root = gitRepo();
    const cfg = configFor(root);
    const first = capture();
    try {
      await doctor(["--apply"], cfg);
    } finally {
      first.restore();
    }
    expect(first.text()).toContain("git config: pull.ff=only");

    const second = capture();
    try {
      await doctor(["--apply"], cfg);
    } finally {
      second.restore();
    }
    expect(second.text()).not.toContain("git config: pull.ff=only");
    expect(second.text()).toContain("git config: core.hooksPath = .githooks");
    expect(gitConfigRead(root, "pull.ff")).toBe("only");
  });

  it("rejects an unknown setup flag with exit 1", async () => {
    const root = tsRepo();
    const res = await expectSetupExit(["--bogus"], configFor(root));
    expect(res.threw).toBe(true);
    expect(res.calls).toEqual([1]);
    expect(res.out).toContain("unknown flag '--bogus' for setup mode");
  });

  it("rejects an unknown --tool id instead of silently doing nothing", async () => {
    const root = tsRepo();
    const res = await expectSetupExit(["--tool", "oxlin"], configFor(root));
    expect(res.threw).toBe(true);
    expect(res.calls).toEqual([1]);
    expect(res.out).toContain("unknown tool id(s): oxlin");
  });

  it("reports nothing to do when every requested tool is already present", async () => {
    const root = tsRepo();
    writeFileSync(join(root, ".oxlintrc.json"), "{}");
    const cap = capture();
    try {
      await doctor(["--tool", "oxlint"], configFor(root));
    } finally {
      cap.restore();
    }
    expect(cap.text()).toContain("Nothing to do");
  });

  it("--tool restricts the written set to the requested tools", async () => {
    const root = tsRepo();
    const plan = capture();
    try {
      await doctor(["--tool=knip"], configFor(root));
    } finally {
      plan.restore();
    }
    expect(plan.text()).toContain("knip.json");
    expect(plan.text()).not.toContain(".oxlintrc.json");

    const applied = capture();
    try {
      await doctor(["--tool=knip", "--apply"], configFor(root));
    } finally {
      applied.restore();
    }
    expect(existsSync(join(root, "knip.json"))).toBe(true);
    expect(existsSync(join(root, ".oxlintrc.json"))).toBe(false);
  });

  it("--root overrides the target root (worktreeRoot untouched)", async () => {
    const home = tsRepo();
    const other = tsRepo();
    const cap = capture();
    try {
      await doctor([`--root=${other}`, "--apply"], configFor(home));
    } finally {
      cap.restore();
    }
    expect(existsSync(join(other, ".oxlintrc.json"))).toBe(true);
    expect(existsSync(join(home, ".oxlintrc.json"))).toBe(false);
  });

  it("records a dry-run outcome on the active run record", async () => {
    const root = tsRepo();
    const cfg = configFor(root);
    let dir = "";
    const cap = capture();
    try {
      const run = beginRun(cfg, "doctor", [], null, "main");
      if (run === null) throw new Error("run record not created");
      dir = run.dir;
      await doctor([], cfg);
    } finally {
      cap.restore();
      finishActiveRun(0);
    }
    const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as {
      outcome?: { doctor?: string; };
    };
    expect(meta.outcome?.doctor).toMatch(/^dry-run: \d+ file\(s\) planned$/);
  });

  it("warns instead of throwing when git config cannot be applied", async () => {
    const root = tsRepo();
    // A .git directory that is not a repository: detection sees a git repo,
    // but every `git config` invocation fails.
    mkdirSync(join(root, ".git"));
    const cap = capture();
    try {
      await doctor(["--apply"], configFor(root));
    } finally {
      cap.restore();
    }
    const out = cap.text();
    expect(out).toContain("git config failed:");
    expect(out).toContain("git config core.hooksPath failed:");
    expect(out).toContain("Wrote ");
  });
});

async function expectCheckExit(
  args: string[],
  cfg: WorktreeConfig,
): Promise<{ calls: number[]; out: string; }> {
  const saved = process.exitCode;
  process.exitCode = 0;
  const exit = exitSentinel();
  const cap = capture();
  let out = "";
  try {
    await doctor(["check", ...args], cfg);
  } catch {
    /* sentinel */
  } finally {
    out = cap.text();
    cap.restore();
    exit.restore();
    process.exitCode = saved;
  }
  return { calls: exit.calls, out };
}

describe("doctor() check subcommand", () => {
  const runCheck = async (
    args: string[],
    cfg: WorktreeConfig,
  ): Promise<{ out: string; exitCode: number | undefined; }> => {
    const saved = process.exitCode;
    process.exitCode = 0;
    const cap = capture();
    try {
      await doctor(["check", ...args], cfg);
    } finally {
      cap.restore();
    }
    const exitCode = process.exitCode;
    process.exitCode = saved;
    return { out: cap.text(), exitCode };
  };

  it("resolves --help before subcommand dispatch (top-level help wins)", async () => {
    const root = tsRepo();
    const { out, exitCode } = await runCheck(["--help"], configFor(root));
    expect(out).toContain("Usage: giwt doctor [--apply]");
    expect(out).toContain("giwt doctor check [--json]");
    expect(exitCode).toBe(0);
  });

  it("rejects unknown flags, check ids and bad --jobs with exit 1", async () => {
    const root = tsRepo();
    const cfg = configFor(root);
    const flag = await expectCheckExit(["--bogus"], cfg);
    expect(flag.calls).toEqual([1]);
    expect(flag.out).toContain("unknown flag '--bogus'");

    const id = await expectCheckExit(["--checks", "lint,bogus"], cfg);
    expect(id.calls).toEqual([1]);
    expect(id.out).toContain("unknown check id(s): bogus");

    for (const jobs of ["0", "abc"]) {
      const bad = await expectCheckExit(["--jobs", jobs], cfg);
      expect(bad.calls).toEqual([1]);
      expect(bad.out).toContain("--jobs must be an integer >= 1");
    }
  });

  it("reports todo findings with FAIL/warn/ok tags and an exit code", async () => {
    const clean = tsRepo();
    const ok = await runCheck(["--checks", "todo", "--root", clean], configFor(clean));
    expect(ok.out).toContain("[ok] todo (comment-scan) — 0 finding(s)");
    expect(ok.exitCode).toBe(0);

    const warn = tsRepo();
    writeFileSync(join(warn, "src", "a.ts"), "// TODO: tidy this up\n");
    const warned = await runCheck(["--checks=todo", "--root", warn], configFor(warn));
    expect(warned.out).toContain("[warn] todo (comment-scan) — 1 finding(s)");
    expect(warned.out).toContain("src/a.ts:1 [TODO] tidy this up");
    expect(warned.exitCode).toBe(0);

    const fail = tsRepo();
    writeFileSync(join(fail, "src", "a.ts"), "// TODO: tidy this up\n// FIXME: broken\n");
    const failed = await runCheck(["--checks", "todo", "--root", fail], configFor(fail));
    expect(failed.out).toContain("[FAIL] todo (comment-scan) — 2 finding(s)");
    expect(failed.out).toContain("src/a.ts:2 [FIXME] broken");
    expect(failed.exitCode).toBe(1);
  });

  it("emits the JSON report contract with --json", async () => {
    const root = tsRepo();
    writeFileSync(join(root, "src", "a.ts"), "// FIXME: broken\n");
    const { out, exitCode } = await runCheck(
      ["--checks=todo", "--json", `--root=${root}`, "--jobs=1"],
      configFor(root),
    );
    const start = out.indexOf("{");
    expect(start).toBeGreaterThanOrEqual(0);
    const report = JSON.parse(out.slice(start)) as DoctorCheckReport;
    expect(report.version).toBe(1);
    expect(report.root).toBe(root);
    expect(report.checks[0]?.id).toBe("todo");
    expect(report.checks[0]?.findings[0]?.rule).toBe("FIXME");
    expect(exitCode).toBe(1);
  });

  it("marks non-applicable checks as skipped", async () => {
    const root = tsRepo();
    const { out, exitCode } = await runCheck(
      ["--checks", "lint", "--root", root],
      configFor(root),
    );
    expect(out).toContain("[=] lint — skipped (not applicable to this project)");
    expect(exitCode).toBe(0);
  });

  it("reports a failed check with [FAIL] and exit 1", async () => {
    const root = tsRepo();
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "e2e", scripts: { test: "false" } }),
    );
    const cfg: WorktreeConfig = {
      ...configFor(root),
      settings: {
        ...DEFAULT_SETTINGS,
        commands: { ...DEFAULT_SETTINGS.commands, test: "false" },
      },
    };
    const { out, exitCode } = await runCheck(["--checks", "tests", "--root", root], cfg);
    expect(out).toContain("[FAIL] tests (false) — test command exited 1");
    expect(exitCode).toBe(1);
  });

  it("reports no applicable checks when the filter selects nothing", async () => {
    const root = scratchDir();
    const { out, exitCode } = await runCheck(["--checks", ",", "--root", root], configFor(root));
    expect(out).toContain("No applicable checks for this project");
    expect(exitCode).toBe(0);
  });

  it("records the doctor summary and failedGates on the run record", async () => {
    const root = tsRepo();
    writeFileSync(join(root, "src", "a.ts"), "// FIXME: broken\n");
    const cfg = configFor(root);
    let dir = "";
    const saved = process.exitCode;
    process.exitCode = 0;
    const cap = capture();
    try {
      const run = beginRun(cfg, "doctor", ["check"], null, "main");
      if (run === null) throw new Error("run record not created");
      dir = run.dir;
      await doctor(["check", "--checks", "todo", "--root", root], cfg);
    } finally {
      cap.restore();
      finishActiveRun(process.exitCode ?? 0);
      process.exitCode = saved;
    }
    const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as {
      exitCode?: number;
      outcome?: { doctor?: string; failedGates?: string[]; };
    };
    expect(meta.outcome?.doctor).toBe("0/1 ok, 1 failed, 0 skipped, 1 findings");
    expect(meta.outcome?.failedGates).toEqual(["todo"]);
    expect(meta.exitCode).toBe(1);
  });
});

describe("collectFiles", () => {
  const base = (): ProjectReport => detectProject(scratchDir());

  it("adds actionlint only for a git repo with workflows", () => {
    const bare = base();
    const noWorkflows = collectFiles(
      { ...bare, git: { ...bare.git, isGitRepo: true } },
      { dryRun: true },
      null,
    );
    expect(noWorkflows.some((f) => f.path === ".github/actionlint.yaml")).toBe(false);

    const withWorkflows = collectFiles(
      {
        ...bare,
        git: { ...bare.git, isGitRepo: true },
        existing: { ...bare.existing, workflows: true },
      },
      { dryRun: true },
      null,
    );
    expect(withWorkflows.some((f) => f.path === ".github/actionlint.yaml")).toBe(true);
  });

  it("adds renovate/dependabot for a git repo without dep automation", () => {
    const bare = base();
    const paths = collectFiles(
      { ...bare, git: { ...bare.git, isGitRepo: true } },
      { dryRun: true },
      null,
    ).map((f) => f.path);
    expect(paths).toContain("renovate.json");
    expect(paths).toContain(".github/dependabot.yml");
  });

  it("adds lefthook/eslint only when explicitly requested", () => {
    const bare = base();
    const without = collectFiles(bare, { dryRun: true }, null).map((f) => f.path);
    expect(without).not.toContain("lefthook.yml");
    expect(without).not.toContain("eslint.config.mjs");

    const withOptIn = collectFiles(
      bare,
      { dryRun: true, tools: ["lefthook", "eslint"] },
      null,
    ).map((f) => f.path);
    expect(withOptIn).toContain("lefthook.yml");
    expect(withOptIn).toContain("eslint.config.mjs");
  });

  it("honors a tool filter and skips tools that already exist", () => {
    const bare = base();
    const filtered = collectFiles(bare, { dryRun: true }, new Set(["knip"]));
    expect(filtered.map((f) => f.path)).toEqual(["knip.json"]);

    const existing = collectFiles(
      { ...bare, existing: { ...bare.existing, knip: true } },
      { dryRun: true },
      new Set(["knip"]),
    );
    expect(existing).toEqual([]);
  });
});
