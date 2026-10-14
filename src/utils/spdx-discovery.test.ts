// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isolatedGitEnv } from "./git";
import { scratchRoot } from "./scratch-tmp";
import {
  defaultGitRunner,
  filterCheckableFiles,
  getStagedFiles,
  getTrackedFiles,
  hasCheckableExtension,
  isExcluded,
  setExcludePatterns,
  setGitRunner,
} from "./spdx-discovery";

describe("hasCheckableExtension", () => {
  test("accepts known extensions", () => {
    expect(hasCheckableExtension("src/foo.ts")).toBe(true);
    expect(hasCheckableExtension("src/foo.tsx")).toBe(true);
    expect(hasCheckableExtension("src/foo.js")).toBe(true);
    expect(hasCheckableExtension("src/foo.mjs")).toBe(true);
    expect(hasCheckableExtension("src/foo.html")).toBe(true);
    expect(hasCheckableExtension("src/foo.css")).toBe(true);
    expect(hasCheckableExtension("docs/foo.md")).toBe(true);
    expect(hasCheckableExtension("docs/foo.mdx")).toBe(true);
  });

  test("rejects unknown extensions", () => {
    expect(hasCheckableExtension("src/foo.py")).toBe(false);
    expect(hasCheckableExtension("src/foo.json")).toBe(false);
    expect(hasCheckableExtension("Makefile")).toBe(false);
  });
});

describe("isExcluded", () => {
  test("excludes common patterns", () => {
    expect(isExcluded("src/db/migrations/foo.ts")).toBe(true);
    expect(isExcluded("src/node_modules/foo/index.js")).toBe(true);
    expect(isExcluded("src/dist/bundle.js")).toBe(true);
    expect(isExcluded("src/types.d.ts")).toBe(true);
    expect(isExcluded("src/foo.test.ts")).toBe(true);
    expect(isExcluded("src/foo.spec.ts")).toBe(true);
  });

  test("does not exclude normal source files", () => {
    expect(isExcluded("src/index.ts")).toBe(false);
    expect(isExcluded("docs/readme.md")).toBe(false);
  });

  test("respects extra exclude patterns", () => {
    setExcludePatterns([/generated/]);
    try {
      expect(isExcluded("src/generated/foo.ts")).toBe(true);
      expect(isExcluded("src/index.ts")).toBe(false);
    } finally {
      setExcludePatterns([]);
    }
  });
});

describe("filterCheckableFiles", () => {
  test("filters by extension and exclusion", () => {
    const files = [
      "src/foo.ts",
      "src/bar.py",
      "src/baz.test.ts",
      "src/qux.d.ts",
      "",
      "   ",
    ];
    expect(filterCheckableFiles(files)).toEqual(["src/foo.ts"]);
  });
});

describe("getStagedFiles / getTrackedFiles", () => {
  test("getStagedFiles filters staged files", async () => {
    setGitRunner(async () => "src/foo.ts\nsrc/bar.py\n");
    try {
      const files = await getStagedFiles("/repo");
      expect(files).toEqual(["src/foo.ts"]);
    } finally {
      setGitRunner(defaultGitRunner);
    }
  });

  test("getTrackedFiles filters tracked files", async () => {
    setGitRunner(async () => "src/index.ts\nREADME.md\n");
    try {
      const files = await getTrackedFiles("/repo");
      expect(files).toEqual(["src/index.ts", "README.md"]);
    } finally {
      setGitRunner(defaultGitRunner);
    }
  });

  test("default runner executes real git against the repo root (no setGitRunner)", async () => {
    const root = mkdtempSync(join(scratchRoot(), "giwt-spdx-discovery-"));
    try {
      const git = (...args: string[]): void => {
        const proc = Bun.spawnSync(["git", "-C", root, ...args], {
          stdout: "pipe",
          stderr: "pipe",
          env: isolatedGitEnv(),
        });
        if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${proc.stderr}`);
      };
      git("init", "-q", "-b", "main");
      git("config", "user.email", "spdx-discovery@fixture.localhost");
      git("config", "user.name", "spdx discovery fixture");
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "app.ts"), "export {};\n");
      writeFileSync(join(root, "README.md"), "readme\n");
      writeFileSync(join(root, "data.json"), "{}\n");
      git("add", "-A");
      git("commit", "-qm", "seed");

      // Real `git ls-files` pinned to the root — including from a subdirectory
      // cwd (the old runner broke exactly here).
      const prevCwd = process.cwd();
      process.chdir(join(root, "src"));
      try {
        expect(await getTrackedFiles(root)).toEqual(["README.md", "src/app.ts"]);
      } finally {
        process.chdir(prevCwd);
      }

      // Real staged listing: a newly staged checkable file, a non-checkable one.
      writeFileSync(join(root, "src", "next.ts"), "export {};\n");
      writeFileSync(join(root, "notes.py"), "# py\n");
      git("add", "src/next.ts", "notes.py");
      expect(await getStagedFiles(root)).toEqual(["src/next.ts"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
