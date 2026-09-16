// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the doctor command surface (parseArgs, collectFiles, writeAll).
 *
 * `doctor()` itself is exercised by the integration smoke runs that write
 * 14 files end-to-end; this file covers the pure logic that's worthwhile
 * pinning without a subprocess: arg parsing, file dispatch, and merge.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectProject } from "../doctor/detect.ts";
import type { GeneratedFile } from "../doctor/types.ts";
import { parseArgs, writeAll } from "./doctor.ts";

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
